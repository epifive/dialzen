import "server-only";
import { listAudit, toAuditRecord, type AuditFilter, type AuditRecord } from "./audit";
import { getDb } from "./db";
import { dayBoundsIso } from "./jobs/shared";
import { normalizeDay } from "@/voice/normalize";

/**
 * Filters and labels of the audit log viewers (Workspace → Compliance → Audit log and Admin →
 * Compliance → Audit search) and their CSV exports.
 */

/** Action prefixes offered as categories. */
export const AUDIT_CATEGORIES = ["consent.", "dnc.", "opt_out.", "call.", "campaign.", "contacts.", "compliance.", "outbound.", "aup.", "kill_switch.", "credits.", "wallet.", "retention.", "number.", "agent.", "provider_keys."] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface AuditQuery {
  category?: string;
  /** "YYYY-MM-DD" in `timezone`. */
  from?: string;
  to?: string;
  /** Entity id contains (phone number, call id…), exact match. */
  entity?: string;
  before?: number;
}

/** AuditFilter from query-string values (invalid values are ignored). */
export function auditFilterFrom(q: AuditQuery, timezone: string, limit = 50): AuditFilter {
  const filter: AuditFilter = { limit };
  if (q.category && (AUDIT_CATEGORIES as readonly string[]).includes(q.category)) filter.actionPrefix = q.category;
  const from = normalizeDay(q.from);
  const to = normalizeDay(q.to);
  if (from) filter.from = dayBoundsIso(from, timezone).start;
  if (to) filter.to = dayBoundsIso(to, timezone).end;
  const entity = (q.entity ?? "").trim().slice(0, 64);
  if (entity) filter.entityId = entity;
  if (q.before && Number.isInteger(q.before) && q.before > 0) filter.beforeId = q.before;
  return filter;
}

/** Names of the people behind user / admin entries. */
export async function auditActorNames(records: AuditRecord[]): Promise<Map<number, string>> {
  const ids = [...new Set(records.filter((r) => (r.actorType === "user" || r.actorType === "admin") && r.actorId).map((r) => r.actorId!))];
  if (!ids.length) return new Map();
  const db = await getDb();
  const rows = await db.selectFrom("users").select(["id", "name", "email"]).where("id", "in", ids).execute();
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

/** One-line summary of an entry's details (no secrets are ever stored there). */
export function auditDetails(data: Record<string, unknown>, max = 160): string {
  const parts = Object.entries(data).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  const s = parts.join(" · ");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Up to `max` entries for a CSV export (newest first). */
export async function auditForExport(workspaceId: number | null, filter: AuditFilter, max = 10_000): Promise<AuditRecord[]> {
  const out: AuditRecord[] = [];
  let before = filter.beforeId;
  while (out.length < max) {
    const page = await listAudit(workspaceId, { ...filter, beforeId: before, limit: 1000 });
    out.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1].id;
  }
  return out.slice(0, max);
}

export function auditCsvRows(records: AuditRecord[], names: Map<number, string>): unknown[][] {
  return [
    ["id", "time", "workspace_id", "actor_type", "actor", "action", "entity_type", "entity_id", "ip", "details"],
    ...records.map((r) => [r.id, r.createdAt, r.workspaceId ?? "", r.actorType, r.actorId ? (names.get(r.actorId) ?? r.actorId) : "", r.action, r.entityType, r.entityId, r.ip, JSON.stringify(r.data)]),
  ];
}

/**
 * Admin audit search across the platform: `scope` = a workspace id, "platform" (entries without a
 * workspace: admin actions, global DNC) or "all".
 */
export async function searchAudit(scope: number | "platform" | "all", filter: AuditFilter): Promise<AuditRecord[]> {
  if (scope === "platform") return listAudit(null, filter);
  if (typeof scope === "number") return listAudit(scope, filter);
  const db = await getDb();
  let q = db.selectFrom("audit_log").selectAll();
  if (filter.actionPrefix) q = q.where("action", "like", `${filter.actionPrefix.replace(/[%_\\]/g, "")}%`);
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

/** Admin audit scope from a query value: a workspace id, "platform" or everything. */
export function auditScopeOf(v: string | null | undefined): number | "platform" | "all" {
  if (v === "platform") return "platform";
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : "all";
}
