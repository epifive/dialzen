import "server-only";
import { getDb, now } from "./db";
import type { NotifyChannelRow } from "./db/schema";
import { isNotifyChannelType, normalizeNotifyConfig, normalizeNotifyEvents, parseJson } from "@/voice/normalize";
import type { NotifyChannelType, NotifyConfigByType, NotifyEvent } from "@/voice/types";

/**
 * Notification channels of a workspace (email, webhook, Slack, Discord, Microsoft Teams,
 * Telegram): where "call failed", "booking made", "caller opted out", "low balance"…
 * notifications go.
 */
export interface NotifyChannelRecord<T extends NotifyChannelType = NotifyChannelType> {
  id: number;
  workspaceId: number;
  type: T;
  name: string;
  config: NotifyConfigByType[T];
  events: NotifyEvent[];
  isActive: boolean;
  createdAt: string;
}

export const MAX_NOTIFY_CHANNELS = 20;

export function toNotifyChannelRecord(row: NotifyChannelRow): NotifyChannelRecord | null {
  if (!isNotifyChannelType(row.type)) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type,
    name: row.name,
    config: normalizeNotifyConfig(row.type, parseJson(row.config)),
    events: normalizeNotifyEvents(parseJson(row.events)),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

const records = (rows: NotifyChannelRow[]) => rows.map(toNotifyChannelRecord).filter((c): c is NotifyChannelRecord => c !== null);

export async function getNotifyChannels(workspaceId: number): Promise<NotifyChannelRecord[]> {
  const db = await getDb();
  return records(await db.selectFrom("notify_channels").selectAll().where("workspace_id", "=", workspaceId).orderBy("id").execute());
}

export async function getNotifyChannel(workspaceId: number, channelId: number): Promise<NotifyChannelRecord | undefined> {
  if (!Number.isInteger(channelId) || channelId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("notify_channels").selectAll().where("id", "=", channelId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  return row ? (toNotifyChannelRecord(row) ?? undefined) : undefined;
}

/** Active channels of the workspace subscribed to `event`. */
export async function getSubscribedChannels(workspaceId: number, event: NotifyEvent): Promise<NotifyChannelRecord[]> {
  const db = await getDb();
  const rows = await db.selectFrom("notify_channels").selectAll().where("workspace_id", "=", workspaceId).where("is_active", "=", 1).orderBy("id").execute();
  return records(rows).filter((c) => event === "test" || c.events.includes(event));
}

export async function createNotifyChannel<T extends NotifyChannelType>(workspaceId: number, createdBy: number | null, type: T, name: string, config: unknown, events?: unknown): Promise<number> {
  const db = await getDb();
  const ts = now();
  const result = await db
    .insertInto("notify_channels")
    .values({
      workspace_id: workspaceId,
      created_by: createdBy,
      type,
      name: name.trim().slice(0, 120) || type,
      config: JSON.stringify(normalizeNotifyConfig(type, config)),
      events: JSON.stringify(normalizeNotifyEvents(events)),
      is_active: 1,
      created_at: ts,
      updated_at: ts,
    })
    .executeTakeFirstOrThrow();
  return Number(result.insertId);
}

export async function updateNotifyChannel(channel: Pick<NotifyChannelRecord, "id" | "type">, input: { name?: string; config?: unknown; events?: unknown; isActive?: boolean }): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("notify_channels")
    .set({
      ...(input.name !== undefined ? { name: input.name.trim().slice(0, 120) || channel.type } : {}),
      ...(input.config !== undefined ? { config: JSON.stringify(normalizeNotifyConfig(channel.type, input.config)) } : {}),
      ...(input.events !== undefined ? { events: JSON.stringify(normalizeNotifyEvents(input.events)) } : {}),
      ...(input.isActive !== undefined ? { is_active: input.isActive ? 1 : 0 } : {}),
      updated_at: now(),
    })
    .where("id", "=", channel.id)
    .execute();
}

export async function deleteNotifyChannel(channel: Pick<NotifyChannelRecord, "id">): Promise<void> {
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    await trx.updateTable("alert_log").set({ notify_channel_id: null }).where("notify_channel_id", "=", channel.id).execute();
    await trx.deleteFrom("notify_channels").where("id", "=", channel.id).execute();
  });
}

export async function logNotification(entry: { workspaceId: number | null; callId?: number | null; channelId: number | null; event: string; ok: boolean; error?: string | null }): Promise<void> {
  const db = await getDb();
  await db
    .insertInto("alert_log")
    .values({
      workspace_id: entry.workspaceId,
      call_id: entry.callId ?? null,
      notify_channel_id: entry.channelId,
      event: entry.event.slice(0, 30),
      ok: entry.ok ? 1 : 0,
      error: entry.error ? entry.error.slice(0, 500) : null,
      created_at: now(),
    })
    .execute();
}
