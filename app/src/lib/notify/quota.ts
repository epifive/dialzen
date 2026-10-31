import "server-only";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { usageMonth } from "@/lib/usage";
import { buildNotifyPayload, notifyOwner } from "./index";

/**
 * Plan usage notifications: quota_warning at 80 % and quota_reached at 100 % of the plan's included
 * call minutes (checked when calls are settled) or AI assistant requests. Each kind and level is
 * sent at most once per calendar month (UTC), to the owner's account email and notification
 * channels. Unlimited plans never alert. (Agents, numbers and seats are refused at the limit
 * with a message in the dashboard instead.)
 */

export type QuotaKind = "minutes" | "ai";

const TEXT: Record<QuotaKind, { what: string; warning: string; reached: string }> = {
  minutes: {
    what: "Included call minutes this month",
    warning: "You have used {used} of the {limit} call minutes your plan includes this month.",
    reached: "You have used all {limit} call minutes your plan includes this month. Further minutes are paid from your workspaces' call credit balance.",
  },
  ai: {
    what: "AI assistant requests this month",
    warning: "You have used {used} of the {limit} AI assistant requests your plan includes this month.",
    reached: "You have used all {limit} AI assistant requests your plan includes this month.",
  },
};

/** Claim "kind:event" in this month's usage row; false when it was sent already (or another request claimed it). */
async function claim(userId: number, tags: string[]): Promise<boolean> {
  const db = await getDb();
  const month = usageMonth();
  const read = () => db.selectFrom("usage_monthly").select("quota_alerts").where("user_id", "=", userId).where("month", "=", month).executeTakeFirst();
  let row = await read();
  if (!row) {
    await db.insertInto("usage_monthly").values({ user_id: userId, month, seconds_used: 0, calls: 0, ai_requests: 0, quota_alerts: "" }).execute().catch(() => undefined);
    row = await read();
    if (!row) return false;
  }
  const sent = (row.quota_alerts ?? "").split(",").filter(Boolean);
  if (sent.includes(tags[0])) return false;
  const next = [...new Set([...sent, ...tags])].join(",").slice(0, 255);
  let q = db.updateTable("usage_monthly").set({ quota_alerts: next }).where("user_id", "=", userId).where("month", "=", month);
  q = row.quota_alerts === null ? q.where("quota_alerts", "is", null) : q.where("quota_alerts", "=", row.quota_alerts);
  return Number((await q.executeTakeFirst()).numUpdatedRows) === 1;
}

/** Send quota_warning / quota_reached when `used` reaches 80 % / 100 % of `limit` (once per month each). Never throws. */
export async function checkQuotaAlerts(userId: number, kind: QuotaKind, used: number, limit: number): Promise<void> {
  try {
    if (limit <= 0 || used < limit * 0.8) return;
    const reached = used >= limit;
    const event = reached ? "quota_reached" : "quota_warning";
    // Reaching the limit also covers the 80 % alert of the month.
    if (!(await claim(userId, reached ? [`${kind}:${event}`, `${kind}:quota_warning`] : [`${kind}:${event}`]))) return;
    const text = TEXT[kind];
    const message = (reached ? text.reached : text.warning).replace("{used}", used.toLocaleString("en-US")).replace("{limit}", limit.toLocaleString("en-US"));
    const payload = await buildNotifyPayload(null, event, message, { quota: text.what, used, limit });
    payload.url = absoluteUrl(await getSettings(), "/account");
    await notifyOwner(userId, payload);
  } catch (error) {
    console.error("[dialzen] quota notification failed:", error);
  }
}
