import "server-only";
import crypto from "node:crypto";
import { auditSafe } from "./audit";
import { getDb, now } from "./db";
import type { Payment } from "./db/schema";
import type { Entitlements } from "./plans";
import { sellPricePerMinMicros, simulatedAllowed } from "./providers";
import { getSettings, type Settings } from "./settings";
import { includedSecondsLeft } from "./usage";
import { creditWallet, getWallet } from "./wallet";
import { estimateReserveMicros, isProvider, RESERVE_CAP_SEC } from "@/voice/normalize";
import type { ProviderId } from "@/voice/types";

/**
 * Call-credit billing around the wallet (src/lib/wallet.ts): sell prices per minute, credit packs
 * bought through the site's payment gateways (payments.purpose = "credits"), the pre-dial funds
 * check, wallet adjustments by the admin, and the per-tenant P&L (what workspaces paid for their
 * minutes against what the voice providers charged).
 */

// ── Prices ──

/** What a workspace pays per call minute (micros) for a provider: the admin's price, or the BYO platform fee. */
export function pricePerMinuteMicros(settings: Settings, provider: string, keySource: "platform" | "byo" = "platform"): number {
  return sellPricePerMinMicros(settings, isProvider(provider) ? provider : "simulated", keySource);
}

/** Sell prices of every provider (for the billing page; the simulated one while it is allowed). */
export function priceList(settings: Settings): Array<{ provider: ProviderId | "byo"; micros: number }> {
  return [
    { provider: "elevenlabs", micros: pricePerMinuteMicros(settings, "elevenlabs") },
    { provider: "retell", micros: pricePerMinuteMicros(settings, "retell") },
    ...(simulatedAllowed(settings) ? [{ provider: "simulated" as const, micros: pricePerMinuteMicros(settings, "simulated") }] : []),
    { provider: "byo", micros: pricePerMinuteMicros(settings, "", "byo") },
  ];
}

/** Credit pack amounts (major currency units) offered to workspaces, from Admin → Voice providers. */
export function creditPacks(settings: Settings): number[] {
  return [
    ...new Set(
      String(settings.credit_packs)
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 100_000)
        .map((n) => Math.round(n * 100) / 100),
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, 12);
}

// ── Funds check before dialing ──

export type FundsCheck = { ok: true; via: "included" | "wallet"; reserveMicros: number } | { ok: false; reason: "no_credits"; reserveMicros: number; balanceMicros: number };

/**
 * Whether a workspace can pay for one more call: the owner's included minutes still cover the
 * reserve window, or the wallet holds the reserve (min(max duration, 5 min) at the price per
 * minute). The dialer reserves the real amount atomically; this is the cheap check before it.
 */
export async function checkCallFunds(input: { workspaceId: number; ownerId: number; entitlements: Pick<Entitlements, "includedMinutesMonthly">; provider: string; keySource?: "platform" | "byo"; maxDurationSec: number }): Promise<FundsCheck> {
  const settings = await getSettings();
  const price = pricePerMinuteMicros(settings, input.provider, input.keySource ?? "platform");
  const reserveMicros = estimateReserveMicros(input.maxDurationSec, price);
  const window = Math.min(Math.max(60, input.maxDurationSec), RESERVE_CAP_SEC);
  if ((await includedSecondsLeft(input.ownerId, input.entitlements)) >= window) return { ok: true, via: "included", reserveMicros };
  if (reserveMicros === 0) return { ok: true, via: "wallet", reserveMicros };
  const wallet = await getWallet(input.workspaceId);
  if (wallet.balanceMicros >= reserveMicros) return { ok: true, via: "wallet", reserveMicros };
  return { ok: false, reason: "no_credits", reserveMicros, balanceMicros: wallet.balanceMicros };
}

// ── Credit packs (payments with purpose "credits") ──

/** Amounts in payments are in cents; credits in micros. */
export const centsToMicros = (cents: number) => Math.round(cents) * 10_000;

export async function createCreditPayment(input: { userId: number; workspaceId: number; amountCents: number; currency: string; provider: Payment["provider"]; providerRef: string; note?: string | null; status?: "pending" | "paid" }): Promise<number> {
  const db = await getDb();
  const res = await db
    .insertInto("payments")
    .values({
      user_id: input.userId,
      plan_id: 0,
      purpose: "credits",
      workspace_id: input.workspaceId,
      credits_micros: centsToMicros(input.amountCents),
      amount: Math.round(input.amountCents),
      currency: input.currency.toUpperCase(),
      billing_cycle: "monthly",
      provider: input.provider,
      provider_ref: input.providerRef,
      status: input.status ?? "pending",
      note: input.note ?? null,
      created_at: now(),
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

/**
 * Adds the credits of a paid credit-pack payment to its workspace's wallet (once per payment,
 * creditWallet() refuses a second purchase row for the same payment id) and resumes campaigns the
 * engine paused for lack of credits.
 */
export async function applyCreditPayment(payment: Payment): Promise<boolean> {
  if (payment.purpose !== "credits" || !payment.workspace_id) return false;
  const micros = Number(payment.credits_micros ?? centsToMicros(payment.amount));
  const res = await creditWallet(payment.workspace_id, micros, { kind: "purchase", paymentId: payment.id, note: `Credit pack (${payment.provider})`, createdBy: payment.user_id });
  if (!res.ok) return false;
  await auditSafe({ workspaceId: payment.workspace_id, actor: { type: "user", id: payment.user_id }, action: "credits.purchased", entityType: "payment", entityId: payment.id, data: { micros, provider: payment.provider } });
  try {
    const { resumeCampaignsAfterTopUp } = await import("./campaigns");
    await resumeCampaignsAfterTopUp(payment.workspace_id);
  } catch (error) {
    console.error("[dialzen] resuming campaigns after a top-up failed:", error);
  }
  return true;
}

/** Workspace whose pending offline credit payment exists (one at a time). */
export async function pendingOfflineCreditPayment(workspaceId: number): Promise<Payment | undefined> {
  const db = await getDb();
  return db.selectFrom("payments").selectAll().where("workspace_id", "=", workspaceId).where("purpose", "=", "credits").where("provider", "=", "offline").where("status", "=", "pending").executeTakeFirst();
}

export async function listCreditPayments(workspaceId: number, limit = 20): Promise<Payment[]> {
  const db = await getDb();
  return db.selectFrom("payments").selectAll().where("workspace_id", "=", workspaceId).where("purpose", "=", "credits").orderBy("id", "desc").limit(limit).execute();
}

/** A random, unguessable provider reference for offline payments. */
export function offlineRef(): string {
  return `offline:${crypto.randomUUID()}`;
}

// ── Admin: adjustments ──

export type AdjustResult = { ok: true; balanceAfter: number } | { ok: false; error: "workspace" | "amount" | "reason" | "insufficient" };

/** Admin credit / debit of a workspace wallet with a reason (ledger "adjustment" + audit). */
export async function adjustWallet(workspaceId: number, amountMicros: number, reason: string, adminId: number, allowNegative = false): Promise<AdjustResult> {
  const db = await getDb();
  const ws = await db.selectFrom("workspaces").select("id").where("id", "=", workspaceId).executeTakeFirst();
  if (!ws) return { ok: false, error: "workspace" };
  const note = reason.trim().slice(0, 200);
  if (note.length < 3) return { ok: false, error: "reason" };
  if (!Number.isFinite(amountMicros) || Math.round(amountMicros) === 0 || Math.abs(amountMicros) > 1e13) return { ok: false, error: "amount" };
  const res = await creditWallet(workspaceId, amountMicros, { kind: "adjustment", note, createdBy: adminId, allowNegative });
  if (!res.ok) return { ok: false, error: res.reason === "insufficient" ? "insufficient" : "amount" };
  await auditSafe({ workspaceId, actor: { type: "admin", id: adminId }, action: "wallet.adjusted", entityType: "wallet", entityId: workspaceId, data: { micros: Math.round(amountMicros), reason: note, balance: res.balanceAfter } });
  if (amountMicros > 0) {
    try {
      const { resumeCampaignsAfterTopUp } = await import("./campaigns");
      await resumeCampaignsAfterTopUp(workspaceId);
    } catch {
      // Campaigns are resumed by hand then.
    }
  }
  return { ok: true, balanceAfter: res.balanceAfter };
}

// ── P&L ──

/** "YYYY-MM" → [start, end) ISO bounds (UTC). */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString(), to: new Date(Date.UTC(y, m, 1)).toISOString() };
}

export interface MonthlyRevenue {
  month: string;
  /** Plan payments (cents, site currency). */
  plansCents: number;
  /** Credit pack payments (cents). */
  creditsCents: number;
  /** Minutes charged to wallets (micros). */
  usageMicros: number;
  /** Provider cost of all calls (micros). */
  costMicros: number;
}

/** The last `months` months (oldest first): payments by purpose, minutes charged and provider cost. */
export async function revenueByMonth(months: number, currency: string, nowMs = Date.now()): Promise<MonthlyRevenue[]> {
  const d = new Date(nowMs);
  const list: string[] = [];
  for (let i = months - 1; i >= 0; i--) list.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const from = monthBounds(list[0]).from;
  const db = await getDb();
  const [payments, calls] = await Promise.all([
    db.selectFrom("payments").select(["created_at", "amount", "purpose"]).where("status", "=", "paid").where("currency", "=", currency.toUpperCase()).where("created_at", ">=", from).execute(),
    db.selectFrom("calls").select(["created_at", "credits_settled_micros", "provider_cost_micros"]).where("created_at", ">=", from).execute(),
  ]);
  const out = new Map(list.map((m) => [m, { month: m, plansCents: 0, creditsCents: 0, usageMicros: 0, costMicros: 0 }]));
  for (const p of payments) {
    const row = out.get(p.created_at.slice(0, 7));
    if (!row) continue;
    if (p.purpose === "credits") row.creditsCents += Number(p.amount);
    else row.plansCents += Number(p.amount);
  }
  for (const c of calls) {
    const row = out.get(c.created_at.slice(0, 7));
    if (!row) continue;
    row.usageMicros += Number(c.credits_settled_micros);
    row.costMicros += Number(c.provider_cost_micros ?? 0);
  }
  return [...out.values()];
}
