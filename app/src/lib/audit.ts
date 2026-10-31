import "server-only";
import type { Kysely, Transaction } from "kysely";
import { getDb, now } from "./db";
import type { AuditLogRow, Database } from "./db/schema";
import { parseJson } from "@/voice/normalize";

/**
 * The append-only audit trail: consent records, DNC changes and scrubs, dial decisions (allowed
 * or blocked with reasons), AI disclosures, opt-outs, outbound approvals, kill switches, provider
 * key changes and admin actions. It is the evidence a business needs to show how a call was made,
 * so this module only INSERTS and READS: there is no update or delete (rows outlive deleted
 * workspaces, see src/lib/workspaces.ts).
 *
 * Action names are "<entity>.<verb>" in snake_case, e.g. consent.added, consent.revoked,
 * dnc.added, dnc.removed, call.blocked, call.started, opt_out.detected, compliance.updated,
 * outbound.requested, outbound.approved, outbound.rejected, kill_switch.on, provider_keys.updated.
 */

export type AuditActorType = "user" | "api" | "system" | "admin" | "provider";

export interface AuditEntry {
  /** null = platform level (admin actions, global DNC). */
  workspaceId: number | null;
  actor: { type: AuditActorType; id?: number | null };
  action: string;
  entityType?: string;
  entityId?: string | number;
  /** Details (JSON, keep it small: no secrets, no full transcripts). */
  data?: Record<string, unknown>;
  ip?: string;
}

export interface AuditRecord {
  id: number;
  workspaceId: number | null;
  actorType: AuditActorType;
  actorId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

type Db = Kysely<Database> | Transaction<Database>;

const MAX_DATA = 4000;

function serialize(data: Record<string, unknown> | undefined): string {
  if (!data) return "{}";
  const json = JSON.stringify(data);
  return json.length <= MAX_DATA ? json : JSON.stringify({ truncated: true, preview: json.slice(0, MAX_DATA - 60) });
}

/** Appends one entry. Pass `trx` to write it in the same transaction as the change it records. */
export async function audit(entry: AuditEntry, trx?: Db): Promise<void> {
  const db = trx ?? (await getDb());
  await db
    .insertInto("audit_log")
    .values({
      workspace_id: entry.workspaceId,
      actor_type: entry.actor.type,
      actor_id: entry.actor.id ?? null,
      action: entry.action.slice(0, 60),
      entity_type: (entry.entityType ?? "").slice(0, 30),
      entity_id: String(entry.entityId ?? "").slice(0, 64),
      data: serialize(entry.data),
      ip: (entry.ip ?? "").slice(0, 64),
      created_at: now(),
    })
    .execute();
}

/** Like audit() but never throws (logging must not break the action it records). */
export async function auditSafe(entry: AuditEntry, trx?: Db): Promise<void> {
  try {
    await audit(entry, trx);
  } catch (error) {
    console.error("[dialzen] audit log write failed:", error);
  }
}

export function toAuditRecord(row: AuditLogRow): AuditRecord {
  const data = parseJson(row.data);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    data: data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
    ip: row.ip,
    createdAt: row.created_at,
  };
}

export interface AuditFilter {
  action?: string;
  /** Prefix match on the action ("consent." lists every consent entry). */
  actionPrefix?: string;
  entityType?: string;
  entityId?: string | number;
  /** ISO bounds. */
  from?: string;
  to?: string;
  /** Keyset pagination: entries with an id below this. */
  beforeId?: number;
  limit?: number;
}

/** Newest first. `workspaceId` null = platform-level entries only. */
export async function listAudit(workspaceId: number | null, filter: AuditFilter = {}): Promise<AuditRecord[]> {
  const db = await getDb();
  let q = db.selectFrom("audit_log").selectAll();
  q = workspaceId === null ? q.where("workspace_id", "is", null) : q.where("workspace_id", "=", workspaceId);
  if (filter.action) q = q.where("action", "=", filter.action);
  if (filter.actionPrefix) q = q.where("action", "like", `${filter.actionPrefix.replace(/[%_\\]/g, "")}%`);
  if (filter.entityType) q = q.where("entity_type", "=", filter.entityType);
  if (filter.entityId !== undefined) q = q.where("entity_id", "=", String(filter.entityId));
  if (filter.from) q = q.where("created_at", ">=", filter.from);
  if (filter.to) q = q.where("created_at", "<", filter.to);
  if (filter.beforeId) q = q.where("id", "<", filter.beforeId);
  const rows = await q
    .orderBy("id", "desc")
    .limit(Math.min(Math.max(filter.limit ?? 50, 1), 1000))
    .execute();
  return rows.map(toAuditRecord);
}

export interface MemberActivity {
  /** Audit entries by the member in the last 30 days. */
  actions30: number;
  lastActiveAt: string | null;
}

/** Light activity per member from the audit log (no tracking beyond what the app records anyway). */
export async function memberActivity(workspaceId: number): Promise<Map<number, MemberActivity>> {
  const db = await getDb();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [recent, last] = await Promise.all([
    db
      .selectFrom("audit_log")
      .select(["actor_id", (eb) => eb.fn.countAll<number>().as("n")])
      .where("workspace_id", "=", workspaceId)
      .where("actor_type", "=", "user")
      .where("actor_id", "is not", null)
      .where("created_at", ">=", since)
      .groupBy("actor_id")
      .execute(),
    db
      .selectFrom("audit_log")
      .select(["actor_id", (eb) => eb.fn.max("created_at").as("last")])
      .where("workspace_id", "=", workspaceId)
      .where("actor_type", "=", "user")
      .where("actor_id", "is not", null)
      .groupBy("actor_id")
      .execute(),
  ]);
  const out = new Map<number, MemberActivity>();
  for (const r of last) if (r.actor_id) out.set(r.actor_id, { actions30: 0, lastActiveAt: (r.last as string | null) ?? null });
  for (const r of recent) if (r.actor_id) out.set(r.actor_id, { actions30: Number(r.n), lastActiveAt: out.get(r.actor_id)?.lastActiveAt ?? null });
  return out;
}
