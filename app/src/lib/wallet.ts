import "server-only";
import { sql, type Transaction } from "kysely";
import { getDb, now } from "./db";
import type { CreditTransactionRow, Database, WalletRow } from "./db/schema";
import type { Entitlements } from "./plans";
import { consumeIncludedSeconds, incrementUsage } from "./usage";
import { normalizeAutoRecharge, parseJson, priceForSeconds, billableSeconds } from "@/voice/normalize";
import type { AutoRecharge, BillingRounding, CreditKind } from "@/voice/types";

/**
 * Call credits: one wallet per workspace (micros of the site currency) and an append-only ledger.
 *
 *   before dialing   reserveForCall()  balance -= estimate, reserved += estimate  (refused when short)
 *   call ended       billCall()        plan's included minutes first, then settleCall():
 *                                      the reservation comes back (release) and the real charge is
 *                                      taken (settle) — the balance may go slightly negative when a
 *                                      call ran longer than the reserve
 *   no call / failed releaseCall()     the reservation comes back
 *
 * Every balance change is ONE conditional UPDATE inside a transaction that also writes the
 * ledger row; the unique key (call_id, kind) of credit_transactions makes reserve, settle,
 * release and included idempotent per call, so retried webhooks and concurrent ticks can't charge
 * twice. Never update wallets.balance_micros anywhere else.
 */

export interface WalletRecord {
  workspaceId: number;
  balanceMicros: number;
  reservedMicros: number;
  autoRecharge: AutoRecharge;
  lowBalanceMicros: number;
  lowBalanceNotifiedAt: string | null;
  updatedAt: string;
}

export interface CreditTransaction {
  id: number;
  kind: CreditKind;
  amountMicros: number;
  balanceAfter: number;
  callId: number | null;
  paymentId: number | null;
  seconds: number;
  note: string;
  createdBy: number | null;
  createdAt: string;
}

type Trx = Transaction<Database>;

export function toWalletRecord(row: WalletRow): WalletRecord {
  return {
    workspaceId: row.workspace_id,
    balanceMicros: Number(row.balance_micros),
    reservedMicros: Number(row.reserved_micros),
    autoRecharge: normalizeAutoRecharge(parseJson(row.auto_recharge)),
    lowBalanceMicros: Number(row.low_balance_micros),
    lowBalanceNotifiedAt: row.low_balance_notified_at,
    updatedAt: row.updated_at,
  };
}

export function toCreditTransaction(row: CreditTransactionRow): CreditTransaction {
  return {
    id: row.id,
    kind: row.kind,
    amountMicros: Number(row.amount_micros),
    balanceAfter: Number(row.balance_after),
    callId: row.call_id,
    paymentId: row.payment_id,
    seconds: Number(row.seconds),
    note: row.note,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** Creates the wallet row on first use (balance 0). `lowBalanceMicros` = the admin's default alert level. */
export async function ensureWallet(workspaceId: number, lowBalanceMicros = 0): Promise<void> {
  const db = await getDb();
  const exists = await db.selectFrom("wallets").select("workspace_id").where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (exists) return;
  const ts = now();
  try {
    await db
      .insertInto("wallets")
      .values({ workspace_id: workspaceId, balance_micros: 0, reserved_micros: 0, auto_recharge: JSON.stringify(normalizeAutoRecharge({})), low_balance_micros: Math.max(0, Math.round(lowBalanceMicros)), low_balance_notified_at: null, created_at: ts, updated_at: ts })
      .execute();
  } catch {
    // Created concurrently.
  }
}

export async function getWallet(workspaceId: number): Promise<WalletRecord> {
  await ensureWallet(workspaceId);
  const db = await getDb();
  return toWalletRecord(await db.selectFrom("wallets").selectAll().where("workspace_id", "=", workspaceId).executeTakeFirstOrThrow());
}

async function balanceIn(trx: Trx, workspaceId: number): Promise<number> {
  const row = await trx.selectFrom("wallets").select("balance_micros").where("workspace_id", "=", workspaceId).executeTakeFirstOrThrow();
  return Number(row.balance_micros);
}

async function ledgerRow(trx: Trx, callId: number, kind: CreditKind) {
  return trx.selectFrom("credit_transactions").select(["id", "amount_micros", "seconds"]).where("call_id", "=", callId).where("kind", "=", kind).executeTakeFirst();
}

async function insertLedger(trx: Trx, values: { workspaceId: number; kind: CreditKind; amountMicros: number; balanceAfter: number; callId?: number | null; paymentId?: number | null; seconds?: number; note?: string; createdBy?: number | null }): Promise<number> {
  const res = await trx
    .insertInto("credit_transactions")
    .values({
      workspace_id: values.workspaceId,
      kind: values.kind,
      amount_micros: Math.round(values.amountMicros),
      balance_after: Math.round(values.balanceAfter),
      call_id: values.callId ?? null,
      payment_id: values.paymentId ?? null,
      seconds: Math.max(0, Math.floor(values.seconds ?? 0)),
      note: (values.note ?? "").slice(0, 255),
      created_by: values.createdBy ?? null,
      created_at: now(),
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

/** A unique-key violation (the ledger row of this call and kind exists already). */
function isDuplicate(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ""}` : String(error);
  return /unique|duplicate|ER_DUP_ENTRY|SQLITE_CONSTRAINT/i.test(msg);
}

// ── Credits in and out ──

export type CreditResult = { ok: true; balanceAfter: number; transactionId: number } | { ok: false; reason: "duplicate" | "insufficient" | "invalid" };

/**
 * Adds credits (a paid credit pack, a refund or an admin adjustment). Purchases are recorded once
 * per payment id. Negative adjustments are refused when they would make the balance negative,
 * unless `allowNegative`.
 */
export async function creditWallet(
  workspaceId: number,
  amountMicros: number,
  options: { kind: "purchase" | "adjustment"; paymentId?: number | null; note?: string; createdBy?: number | null; allowNegative?: boolean },
): Promise<CreditResult> {
  const amount = Math.round(amountMicros);
  if (!Number.isFinite(amount) || amount === 0 || (options.kind === "purchase" && amount < 0)) return { ok: false, reason: "invalid" };
  await ensureWallet(workspaceId);
  const db = await getDb();
  return db.transaction().execute(async (trx): Promise<CreditResult> => {
    if (options.paymentId) {
      const seen = await trx.selectFrom("credit_transactions").select("id").where("payment_id", "=", options.paymentId).where("kind", "=", "purchase").executeTakeFirst();
      if (seen) return { ok: false, reason: "duplicate" };
    }
    let q = trx.updateTable("wallets").set({ balance_micros: sql`balance_micros + ${amount}`, updated_at: now() }).where("workspace_id", "=", workspaceId);
    if (amount < 0 && !options.allowNegative) q = q.where("balance_micros", ">=", -amount);
    const res = await q.executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) return { ok: false, reason: "insufficient" };
    const balanceAfter = await balanceIn(trx, workspaceId);
    // A balance back above the alert level re-arms the low-balance notification.
    await trx.updateTable("wallets").set({ low_balance_notified_at: null }).where("workspace_id", "=", workspaceId).where("balance_micros", ">", sql<number>`low_balance_micros`).execute();
    const id = await insertLedger(trx, { workspaceId, kind: options.kind, amountMicros: amount, balanceAfter, paymentId: options.paymentId ?? null, note: options.note, createdBy: options.createdBy ?? null });
    return { ok: true, balanceAfter, transactionId: id };
  });
}

export type ReserveResult = { ok: true; balanceAfter: number; reservedMicros: number } | { ok: false; reason: "insufficient" | "duplicate"; balance: number };

/**
 * Holds `amountMicros` for a call before it is dialed. Atomic: a single conditional UPDATE
 * (balance >= amount), so concurrent calls can't both spend the last credits. A call is reserved
 * at most once.
 */
export async function reserveForCall(workspaceId: number, callId: number, amountMicros: number): Promise<ReserveResult> {
  const amount = Math.max(0, Math.round(amountMicros));
  await ensureWallet(workspaceId);
  const db = await getDb();
  try {
    return await db.transaction().execute(async (trx): Promise<ReserveResult> => {
      if (await ledgerRow(trx, callId, "reserve")) return { ok: false, reason: "duplicate", balance: await balanceIn(trx, workspaceId) };
      const res = await trx
        .updateTable("wallets")
        .set({ balance_micros: sql`balance_micros - ${amount}`, reserved_micros: sql`reserved_micros + ${amount}`, updated_at: now() })
        .where("workspace_id", "=", workspaceId)
        .where("balance_micros", ">=", amount)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) !== 1) return { ok: false, reason: "insufficient", balance: await balanceIn(trx, workspaceId) };
      const balanceAfter = await balanceIn(trx, workspaceId);
      await insertLedger(trx, { workspaceId, kind: "reserve", amountMicros: -amount, balanceAfter, callId });
      return { ok: true, balanceAfter, reservedMicros: amount };
    });
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, reason: "duplicate", balance: (await getWallet(workspaceId)).balanceMicros };
    throw error;
  }
}

/** The reservation of a call still held (0 when none or already released). */
async function heldFor(trx: Trx, callId: number): Promise<number> {
  const reserve = await ledgerRow(trx, callId, "reserve");
  if (!reserve) return 0;
  if (await ledgerRow(trx, callId, "release")) return 0;
  return Math.max(0, -Number(reserve.amount_micros));
}

export type SettleResult = { ok: true; balanceAfter: number; chargedMicros: number; releasedMicros: number } | { ok: false; reason: "duplicate" };

/**
 * Finishes the billing of a call: gives back its reservation and takes the real charge, in one
 * transaction (one UPDATE). Idempotent: a call is settled once. The balance may go negative by
 * the difference when a call ran longer than its reservation.
 */
export async function settleCall(workspaceId: number, callId: number, chargeMicros: number, seconds: number, note = ""): Promise<SettleResult> {
  const charge = Math.max(0, Math.round(chargeMicros));
  await ensureWallet(workspaceId);
  const db = await getDb();
  try {
    return await db.transaction().execute(async (trx): Promise<SettleResult> => {
      if (await ledgerRow(trx, callId, "settle")) return { ok: false, reason: "duplicate" };
      const held = await heldFor(trx, callId);
      await trx
        .updateTable("wallets")
        .set({ balance_micros: sql`balance_micros + ${held - charge}`, reserved_micros: sql`CASE WHEN reserved_micros - ${held} < 0 THEN 0 ELSE reserved_micros - ${held} END`, updated_at: now() })
        .where("workspace_id", "=", workspaceId)
        .execute();
      const balanceAfter = await balanceIn(trx, workspaceId);
      if (held > 0) await insertLedger(trx, { workspaceId, kind: "release", amountMicros: held, balanceAfter: balanceAfter + charge, callId });
      await insertLedger(trx, { workspaceId, kind: "settle", amountMicros: -charge, balanceAfter, callId, seconds, note });
      return { ok: true, balanceAfter, chargedMicros: charge, releasedMicros: held };
    });
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

/** Gives a call's reservation back (it never connected, or was canceled). Idempotent. Returns the micros released. */
export async function releaseCall(workspaceId: number, callId: number, note = ""): Promise<number> {
  await ensureWallet(workspaceId);
  const db = await getDb();
  try {
    return await db.transaction().execute(async (trx) => {
      if (await ledgerRow(trx, callId, "settle")) return 0;
      const held = await heldFor(trx, callId);
      if (!held) return 0;
      await trx
        .updateTable("wallets")
        .set({ balance_micros: sql`balance_micros + ${held}`, reserved_micros: sql`CASE WHEN reserved_micros - ${held} < 0 THEN 0 ELSE reserved_micros - ${held} END`, updated_at: now() })
        .where("workspace_id", "=", workspaceId)
        .execute();
      await insertLedger(trx, { workspaceId, kind: "release", amountMicros: held, balanceAfter: await balanceIn(trx, workspaceId), callId, note });
      return held;
    });
  } catch (error) {
    if (isDuplicate(error)) return 0;
    throw error;
  }
}

// ── Billing a finished call ──

export interface BillCallInput {
  workspaceId: number;
  ownerId: number;
  callId: number;
  durationSec: number;
  pricePerMinMicros: number;
  rounding: BillingRounding;
  minimumSec: number;
  entitlements: Pick<Entitlements, "includedMinutesMonthly">;
}

export interface BillCallResult {
  billedSec: number;
  includedSec: number;
  chargedSec: number;
  chargeMicros: number;
  /** null when the call was already settled (nothing changed). */
  balanceAfter: number | null;
  duplicate: boolean;
}

/**
 * Bills a finished call: rounds the duration, takes what fits from the owner's included minutes
 * of the month, charges the rest to the wallet (settleCall) and stores the figures on the call.
 * Safe to call again for the same call (webhook retries, reconciliation): nothing is billed twice.
 */
export async function billCall(input: BillCallInput): Promise<BillCallResult> {
  // The "included" ledger row reads the balance: the wallet must exist even when no credits were ever bought.
  await ensureWallet(input.workspaceId);
  const db = await getDb();
  const billedSec = billableSeconds(input.durationSec, input.rounding, input.durationSec > 0 ? input.minimumSec : 0);
  const settled = await db.selectFrom("credit_transactions").select(["amount_micros", "seconds", "balance_after"]).where("call_id", "=", input.callId).where("kind", "=", "settle").executeTakeFirst();
  if (settled) {
    const included = await db.selectFrom("credit_transactions").select("seconds").where("call_id", "=", input.callId).where("kind", "=", "included").executeTakeFirst();
    const includedSec = Number(included?.seconds ?? 0);
    return { billedSec, includedSec, chargedSec: Math.max(0, billedSec - includedSec), chargeMicros: -Number(settled.amount_micros), balanceAfter: null, duplicate: true };
  }

  // Included minutes: the ledger row is the once-per-call guard.
  let includedSec = 0;
  const existing = await db.selectFrom("credit_transactions").select("seconds").where("call_id", "=", input.callId).where("kind", "=", "included").executeTakeFirst();
  if (existing) includedSec = Number(existing.seconds);
  else if (billedSec > 0) {
    const taken = await consumeIncludedSeconds(input.ownerId, billedSec, input.entitlements);
    if (taken > 0) {
      try {
        await db.transaction().execute(async (trx) => {
          await insertLedger(trx, { workspaceId: input.workspaceId, kind: "included", amountMicros: 0, balanceAfter: await balanceIn(trx, input.workspaceId), callId: input.callId, seconds: taken, note: "Plan minutes" });
        });
        includedSec = taken;
      } catch (error) {
        // Another process recorded it first: give these seconds back and use its figure.
        await incrementUsage(input.ownerId, { secondsUsed: -taken });
        if (!isDuplicate(error)) throw error;
        const row = await db.selectFrom("credit_transactions").select("seconds").where("call_id", "=", input.callId).where("kind", "=", "included").executeTakeFirst();
        includedSec = Number(row?.seconds ?? 0);
      }
    }
  }

  const chargedSec = Math.max(0, billedSec - includedSec);
  const chargeMicros = priceForSeconds(chargedSec, input.pricePerMinMicros);
  const result = await settleCall(input.workspaceId, input.callId, chargeMicros, chargedSec);
  if (!result.ok) return { billedSec, includedSec, chargedSec, chargeMicros, balanceAfter: null, duplicate: true };
  await db
    .updateTable("calls")
    .set({ billed_seconds: billedSec, included_seconds: includedSec, price_per_min_micros: Math.round(input.pricePerMinMicros), credits_settled_micros: chargeMicros, updated_at: now() })
    .where("id", "=", input.callId)
    .execute();
  return { billedSec, includedSec, chargedSec, chargeMicros, balanceAfter: result.balanceAfter, duplicate: false };
}

// ── Reading ──

export async function listTransactions(workspaceId: number, options: { limit?: number; beforeId?: number; kind?: CreditKind; hideZeroSettles?: boolean } = {}): Promise<CreditTransaction[]> {
  const db = await getDb();
  let q = db.selectFrom("credit_transactions").selectAll().where("workspace_id", "=", workspaceId);
  if (options.kind) q = q.where("kind", "=", options.kind);
  // Calls fully covered by included minutes settle at 0: their "included" row says it all.
  if (options.hideZeroSettles) q = q.where((eb) => eb.or([eb("kind", "!=", "settle"), eb("amount_micros", "!=", 0)]));
  if (options.beforeId) q = q.where("id", "<", options.beforeId);
  const rows = await q
    .orderBy("id", "desc")
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 500))
    .execute();
  return rows.map(toCreditTransaction);
}

export async function saveWalletOptions(workspaceId: number, input: { autoRecharge?: unknown; lowBalanceMicros?: number }): Promise<void> {
  await ensureWallet(workspaceId);
  const db = await getDb();
  await db
    .updateTable("wallets")
    .set({
      ...(input.autoRecharge !== undefined ? { auto_recharge: JSON.stringify(normalizeAutoRecharge(input.autoRecharge)) } : {}),
      ...(input.lowBalanceMicros !== undefined ? { low_balance_micros: Math.max(0, Math.round(input.lowBalanceMicros)), low_balance_notified_at: null } : {}),
      updated_at: now(),
    })
    .where("workspace_id", "=", workspaceId)
    .execute();
}

/**
 * Claims the low-balance notification of a wallet (once until the balance is topped up above
 * the level again). True = the caller should send it.
 */
export async function claimLowBalanceAlert(workspaceId: number): Promise<boolean> {
  const db = await getDb();
  const res = await db
    .updateTable("wallets")
    .set({ low_balance_notified_at: now() })
    .where("workspace_id", "=", workspaceId)
    .where("low_balance_micros", ">", 0)
    .where("balance_micros", "<", sql<number>`low_balance_micros`)
    .where("low_balance_notified_at", "is", null)
    .executeTakeFirst();
  return Number(res.numUpdatedRows) === 1;
}
