import "server-only";
import { auditSafe } from "@/lib/audit";
import { getAgent } from "@/lib/agents";
import { getDb, now } from "@/lib/db";
import { addNumber, countOwnerNumbers, findActiveNumber, getNumber, markNumberReleased, numberCredentials, updateNumber, type NumberRecord } from "@/lib/numbers";
import { atLimit, type Entitlements } from "@/lib/plans";
import { providerContext, webhookUrl } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { usageMonth } from "@/lib/usage";
import { creditWallet, getWallet } from "@/lib/wallet";
import { getWorkspace, getWorkspaceEntitlements, type WorkspaceRecord } from "@/lib/workspaces";
import { isProvider, parsePhone, toMicros } from "@/voice/normalize";
import { ProviderError, type Carrier, type NumberImportSpec, type ProviderId } from "@/voice/types";
import { ensureAgentSynced } from "./sync";
import { verifyTwilioNumber } from "./twilio";
import "./index";

/**
 * Phone numbers through the providers: buy (Retell US/CA, simulated), import (Twilio account,
 * SIP trunk), route inbound calls to an agent, release, and the monthly rental charged to the
 * workspace wallet (Admin → Voice providers → number_monthly_price, bought numbers only).
 */

export type NumberActionError = "limit" | "invalid" | "taken" | "provider" | "unsupported" | "credits" | "twilio" | "agent" | "not_found";
export type NumberActionResult = { ok: true; number: NumberRecord } | { ok: false; error: NumberActionError; message: string };

type Ws = Pick<WorkspaceRecord, "id" | "ownerId">;

const fail = (error: NumberActionError, message: string): NumberActionResult => ({ ok: false, error, message });
const providerText = (e: unknown) => (e instanceof ProviderError ? e.message : e instanceof Error ? e.message : "The provider refused the request.");

async function ownerIsAdmin(ownerId: number): Promise<boolean> {
  const db = await getDb();
  const row = await db.selectFrom("users").select("role").where("id", "=", ownerId).executeTakeFirst();
  return row?.role === "admin";
}

/** Monthly rental of a bought number (micros; 0 for admin-owned workspaces). */
export async function rentalPriceMicros(ownerId: number): Promise<number> {
  if (await ownerIsAdmin(ownerId)) return 0;
  return Math.max(0, toMicros((await getSettings()).number_monthly_price));
}

/** Charges one month of a number's rental once (number_rentals is the guard). */
export async function chargeRental(number: Pick<NumberRecord, "id" | "workspaceId" | "e164" | "monthlyPriceMicros">, month = usageMonth()): Promise<boolean> {
  if (number.monthlyPriceMicros <= 0) return false;
  const db = await getDb();
  try {
    await db.insertInto("number_rentals").values({ workspace_id: number.workspaceId, number_id: number.id, month, amount_micros: number.monthlyPriceMicros, transaction_id: null, created_at: now() }).execute();
  } catch {
    return false; // Charged already.
  }
  const res = await creditWallet(number.workspaceId, -number.monthlyPriceMicros, { kind: "adjustment", note: `Number rental ${number.e164} ${month}`, allowNegative: true });
  if (res.ok) await db.updateTable("number_rentals").set({ transaction_id: res.transactionId }).where("number_id", "=", number.id).where("month", "=", month).execute();
  return res.ok;
}

export interface BuyInput {
  provider: string;
  country: string;
  areaCode: string;
  tollFree: boolean;
  label: string;
}

export async function buyNumberFor(workspace: Ws, entitlements: Entitlements, input: BuyInput, userId: number | null): Promise<NumberActionResult> {
  if (!isProvider(input.provider)) return fail("provider", "Choose a voice provider.");
  if (!/^\d{3}$/.test(input.areaCode) && !input.tollFree) return fail("invalid", "Enter a 3-digit area code.");
  const used = await countOwnerNumbers(workspace.ownerId);
  if (atLimit(used, entitlements.maxNumbers)) return fail("limit", `Your plan allows ${entitlements.maxNumbers} phone numbers.`);
  const resolved = await providerContext(workspace.id, input.provider, entitlements);
  if (!resolved) return fail("provider", "This voice provider is not configured.");
  const { provider, ctx } = resolved;
  if (!provider.buyNumber || !provider.capabilities.numbersPurchase) return fail("unsupported", "This provider can't sell numbers. Import one instead.");
  if (!provider.capabilities.purchaseCountries.includes(input.country)) return fail("unsupported", `Numbers can only be bought in ${provider.capabilities.purchaseCountries.join(", ")}.`);
  const rental = ctx.keySource === "byo" ? 0 : await rentalPriceMicros(workspace.ownerId);
  if (rental > 0 && (await getWallet(workspace.id)).balanceMicros < rental) return fail("credits", "Add call credits first: the first month's rental is charged when you buy the number.");
  let ref;
  try {
    ref = await provider.buyNumber(ctx, { country: input.country, areaCode: input.areaCode, tollFree: input.tollFree });
  } catch (error) {
    return fail("provider", providerText(error));
  }
  const carrier: Carrier = input.provider === "retell" ? "retell" : "simulated";
  const added = await addNumber(workspace, entitlements, { e164: ref.e164, provider: input.provider, carrier, label: input.label, providerNumberId: ref.providerNumberId, monthlyPriceMicros: rental, status: "active" }, userId);
  if (!added.ok) {
    await provider.releaseNumber(ctx, ref.providerNumberId).catch(() => undefined);
    return fail(added.error, added.error === "limit" ? "Your plan's number limit is reached." : "The number could not be added.");
  }
  await chargeRental(added.number);
  return { ok: true, number: added.number };
}

export interface ImportInput {
  provider: string;
  carrier: string;
  e164: string;
  label: string;
  twilio?: { accountSid: string; authToken: string };
  sip?: { terminationUri: string; username: string; password: string };
}

export async function importNumberFor(workspace: Ws, entitlements: Entitlements, input: ImportInput, userId: number | null, options: { fetchImpl?: typeof fetch } = {}): Promise<NumberActionResult> {
  if (!isProvider(input.provider)) return fail("provider", "Choose a voice provider.");
  const phone = parsePhone(input.e164);
  if (!phone) return fail("invalid", "Enter the number in international format, e.g. +14155550123.");
  const used = await countOwnerNumbers(workspace.ownerId);
  if (atLimit(used, entitlements.maxNumbers)) return fail("limit", `Your plan allows ${entitlements.maxNumbers} phone numbers.`);
  if (await findActiveNumber(phone.e164)) return fail("taken", "This number is already in use.");
  const resolved = await providerContext(workspace.id, input.provider, entitlements);
  if (!resolved) return fail("provider", "This voice provider is not configured.");
  const { provider, ctx } = resolved;
  const carrier = input.carrier as Carrier;
  if (!provider.capabilities.numbersImport.includes(carrier)) return fail("unsupported", `${input.provider} can't import ${input.carrier} numbers.`);

  const spec: NumberImportSpec = { e164: phone.e164, carrier, label: input.label };
  let credentials: Record<string, string> = {};
  if (carrier === "twilio") {
    const creds = { accountSid: (input.twilio?.accountSid ?? "").trim(), authToken: (input.twilio?.authToken ?? "").trim() };
    if (input.provider !== "simulated") {
      try {
        await verifyTwilioNumber(options.fetchImpl ?? fetch, creds, phone.e164);
      } catch (error) {
        return fail("twilio", providerText(error));
      }
    }
    spec.twilio = creds;
    credentials = { accountSid: creds.accountSid, authToken: creds.authToken };
  } else if (carrier !== "simulated") {
    const sip = { terminationUri: (input.sip?.terminationUri ?? "").trim(), username: (input.sip?.username ?? "").trim(), password: input.sip?.password ?? "" };
    if (!/^(sips?:)?[A-Za-z0-9.-]+(:\d{1,5})?(;[^\s]*)?$/.test(sip.terminationUri)) return fail("invalid", "Enter the SIP trunk's termination URI, e.g. mytrunk.pstn.twilio.com.");
    spec.sip = sip;
    credentials = { terminationUri: sip.terminationUri, username: sip.username, password: sip.password };
  }
  let ref;
  try {
    ref = await provider.importNumber(ctx, spec);
  } catch (error) {
    return fail("provider", providerText(error));
  }
  const added = await addNumber(workspace, entitlements, { e164: phone.e164, provider: input.provider, carrier, label: input.label, providerNumberId: ref.providerNumberId, credentials, monthlyPriceMicros: 0, status: "active" }, userId);
  if (!added.ok) {
    await provider.releaseNumber(ctx, ref.providerNumberId).catch(() => undefined);
    return fail(added.error, "The number could not be added.");
  }
  return { ok: true, number: added.number };
}

/** Routes inbound calls of a number to an agent of the same provider (null = nobody answers). */
export async function setNumberInboundAgent(workspace: Ws, numberId: number, agentId: number | null, options: { providerAgentIdOverride?: string } = {}): Promise<NumberActionResult> {
  const number = await getNumber(workspace.id, numberId);
  if (!number || number.status === "released") return fail("not_found", "This number no longer exists.");
  const ws = await getWorkspace(workspace.id);
  const resolved = ws ? await providerContext(workspace.id, number.provider, await getWorkspaceEntitlements(ws)) : null;
  let providerAgentId: string | null = null;
  if (agentId) {
    let agent = await getAgent(workspace.id, agentId);
    if (!agent) return fail("agent", "This agent no longer exists.");
    if (agent.provider !== number.provider) return fail("agent", `The agent runs on ${agent.provider}; this number is connected to ${number.provider}.`);
    if (!options.providerAgentIdOverride) {
      // Synced (or moved) into the provider account the workspace uses now.
      const synced = await ensureAgentSynced(agent, resolved);
      if (!synced.ok) return fail("agent", `The agent could not be synced: ${synced.error}`);
      agent = synced.agent;
    }
    providerAgentId = options.providerAgentIdOverride ?? agent.providerAgentId;
  }
  if (!resolved) return fail("provider", "This voice provider is not configured.");
  if (number.providerNumberId) {
    try {
      await resolved.provider.setInboundAgent(resolved.ctx, number.providerNumberId, providerAgentId, await webhookUrl(number.provider as ProviderId));
    } catch (error) {
      await updateNumber(workspace.id, number.id, { lastError: providerText(error) });
      return fail("provider", providerText(error));
    }
  }
  await updateNumber(workspace.id, number.id, { inboundAgentId: agentId, lastError: null });
  return { ok: true, number: (await getNumber(workspace.id, number.id))! };
}

/** Releases a number at the provider (bought numbers are given back) and marks it released. */
export async function releaseNumberFor(workspace: Ws, entitlements: Entitlements, numberId: number, userId: number | null): Promise<NumberActionResult> {
  const number = await getNumber(workspace.id, numberId);
  if (!number || number.status === "released") return fail("not_found", "This number no longer exists.");
  const live = await (await getDb())
    .selectFrom("campaigns")
    .select("id")
    .where("workspace_id", "=", workspace.id)
    .where("number_id", "=", number.id)
    .where("status", "in", ["scheduled", "running", "paused"])
    .executeTakeFirst();
  if (live) return fail("taken", "A campaign that isn't finished uses this number.");
  const resolved = await providerContext(workspace.id, number.provider, entitlements);
  if (resolved && number.providerNumberId) {
    try {
      await resolved.provider.releaseNumber(resolved.ctx, number.providerNumberId);
    } catch (error) {
      if (!(error instanceof ProviderError && error.kind === "not_found")) return fail("provider", providerText(error));
    }
  }
  await markNumberReleased(workspace.id, number.id, userId);
  return { ok: true, number: { ...number, status: "released" } };
}

/** Number options a workspace admin changes in the dashboard. */
export async function saveNumberOptions(workspaceId: number, numberId: number, input: { label?: string; outboundEnabled?: boolean; dailyDialCap?: number; outboundAgentId?: number | null }, userId: number | null): Promise<boolean> {
  const number = await getNumber(workspaceId, numberId);
  if (!number || number.status === "released") return false;
  await updateNumber(workspaceId, numberId, input);
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "number.updated", entityType: "number", entityId: numberId, data: input });
  return true;
}

/** Carrier credentials stay encrypted; only whether they exist is shown. */
export async function hasCarrierCredentials(numberId: number): Promise<boolean> {
  return Object.keys(await numberCredentials(numberId)).length > 0;
}

/** The monthly rental job: charges this month's rental of every active bought number once. Returns the numbers charged. */
export async function chargeMonthlyRentals(limit = 200): Promise<number> {
  const db = await getDb();
  const month = usageMonth();
  const rows = await db
    .selectFrom("phone_numbers as n")
    .leftJoin("number_rentals as r", (j) => j.onRef("r.number_id", "=", "n.id").on("r.month", "=", month))
    .select(["n.id", "n.workspace_id", "n.e164", "n.monthly_price_micros"])
    .where("n.status", "=", "active")
    .where("n.monthly_price_micros", ">", 0)
    .where("r.id", "is", null)
    .limit(limit)
    .execute();
  let charged = 0;
  for (const r of rows) {
    if (await chargeRental({ id: r.id, workspaceId: r.workspace_id, e164: r.e164, monthlyPriceMicros: Number(r.monthly_price_micros) }, month)) charged++;
  }
  return charged;
}
