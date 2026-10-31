import "server-only";
import { getDb } from "@/lib/db";
import { mailConfigured } from "@/lib/mail";
import { getSubscribedChannels, logNotification, type NotifyChannelRecord } from "@/lib/notify-channels";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import type { NotifyConfigByType, NotifyEvent, NotifyPayload } from "@/voice/types";
import { sendDiscord } from "./discord";
import { sendEmail } from "./email";
import type { SendContext, SendResult } from "./format";
import { sendSlack } from "./slack";
import { sendTeams } from "./teams";
import { sendTelegram } from "./telegram";
import { sendWebhook } from "./webhook";

export type { SendResult } from "./format";

/**
 * Workspace notifications (call failed, booking made, opt-out, low balance…) delivered to the
 * workspace's notification channels that subscribe to the event, and logged in alert_log.
 * Important events (low balance, outbound decision) fall back to the owner's account email when
 * no channel subscribes to them (option `ownerFallback`).
 * Everything here never throws: a failing Slack must not break call processing.
 */

const TIMEOUT_MS = 8_000;

/** Dashboard path of a workspace (also the default `url` of its notifications). */
export function workspaceDashboardPath(workspaceId: number, sub = ""): string {
  return `/dashboard/w/${workspaceId}${sub ? `/${sub.replace(/^\/+/, "")}` : ""}`;
}

/**
 * Webhooks to private / internal addresses (n8n on the LAN, localhost…) are refused unless
 * the server sets ALLOW_PRIVATE_WEBHOOKS=1. Slack, Discord, Teams and Telegram are public anyway.
 */
function allowPrivateWebhooks(): boolean {
  const v = process.env.ALLOW_PRIVATE_WEBHOOKS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function sendContext(): Promise<SendContext> {
  const settings = await getSettings();
  return { siteName: settings.site_name, allowPrivate: allowPrivateWebhooks(), timeoutMs: TIMEOUT_MS };
}

function withTimeout(work: Promise<SendResult>, ms: number): Promise<SendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<SendResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: `Timed out after ${Math.round(ms / 1000)} s` }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Send one notification to one channel. Never throws. */
export async function sendNotification(channel: NotifyChannelRecord, payload: NotifyPayload, ctx?: SendContext): Promise<SendResult> {
  const context = ctx ?? (await sendContext());
  const work = (async (): Promise<SendResult> => {
    switch (channel.type) {
      case "email":
        return sendEmail(channel.config as NotifyConfigByType["email"], payload, context);
      case "webhook":
        return sendWebhook(channel.config as NotifyConfigByType["webhook"], payload, context);
      case "slack":
        return sendSlack(channel.config as NotifyConfigByType["slack"], payload, context);
      case "discord":
        return sendDiscord(channel.config as NotifyConfigByType["discord"], payload, context);
      case "teams":
        return sendTeams(channel.config as NotifyConfigByType["teams"], payload, context);
      case "telegram":
        return sendTelegram(channel.config as NotifyConfigByType["telegram"], payload, context);
    }
    return { ok: false, error: "Unknown channel type" };
  })().catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Sending failed" }));
  return withTimeout(work, context.timeoutMs + 500);
}

/** The payload every channel receives (also the JSON body of webhooks). `path` defaults to the workspace's dashboard. */
export async function buildNotifyPayload(
  workspace: { id: number; name: string } | null,
  event: NotifyEvent,
  message: string,
  data: Record<string, number | string> = {},
  path?: string,
): Promise<NotifyPayload> {
  const settings = await getSettings();
  return {
    event,
    workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
    message,
    data,
    url: absoluteUrl(settings, path ?? (workspace ? workspaceDashboardPath(workspace.id) : "/dashboard")),
    sent_at: new Date().toISOString(),
  };
}

/**
 * Sends `payload` to the workspace's active notification channels subscribed to its event, in
 * parallel (8 s timeout each), and logs every attempt. Returns the number of deliveries.
 */
export async function notifyWorkspace(workspaceId: number, payload: NotifyPayload, options: { callId?: number | null; ownerFallback?: boolean } = {}): Promise<{ sent: number; failed: number }> {
  try {
    const channels = await getSubscribedChannels(workspaceId, payload.event);
    if (!channels.length) {
      if (!options.ownerFallback) return { sent: 0, failed: 0 };
      // Nobody subscribed (e.g. no notification channel yet): the owner still hears about it by email.
      const ok = await emailWorkspaceOwner(workspaceId, payload, options.callId ?? null);
      return { sent: ok ? 1 : 0, failed: ok ? 0 : 1 };
    }
    const ctx = await sendContext();
    const results = await Promise.all(channels.map((channel) => sendNotification(channel, payload, ctx)));
    let sent = 0;
    await Promise.all(
      results.map((result, i) => {
        if (result.ok) sent += 1;
        return logNotification({ workspaceId, callId: options.callId ?? null, channelId: channels[i].id, event: payload.event, ok: result.ok, error: result.error ?? null }).catch(() => undefined);
      }),
    );
    return { sent, failed: results.length - sent };
  } catch (error) {
    console.error("[dialzen] notification delivery failed:", error);
    return { sent: 0, failed: 0 };
  }
}

/** The workspace owner's account email (fallback of notifyWorkspace), logged in alert_log. Never throws. */
async function emailWorkspaceOwner(workspaceId: number, payload: NotifyPayload, callId: number | null): Promise<boolean> {
  try {
    const db = await getDb();
    const owner = await db.selectFrom("workspaces as w").innerJoin("users as u", "u.id", "w.owner_id").select(["u.email", "u.status"]).where("w.id", "=", workspaceId).executeTakeFirst();
    if (!owner || owner.status !== "active" || !mailConfigured(await getSettings())) return false;
    const ctx = await sendContext();
    const result = await withTimeout(sendEmail({ to: owner.email }, payload, ctx), ctx.timeoutMs + 500);
    await logNotification({ workspaceId, callId, channelId: null, event: payload.event, ok: result.ok, error: result.error ?? null }).catch(() => undefined);
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * Account notifications (plan usage): sent to the owner's account email and to the subscribed
 * notification channels of every workspace the owner owns (an email channel to the same address
 * replaces the account email). Returns the number of successful deliveries. Never throws.
 */
export async function notifyOwner(userId: number, payload: NotifyPayload): Promise<number> {
  try {
    const db = await getDb();
    const user = await db.selectFrom("users").select(["email", "status"]).where("id", "=", userId).executeTakeFirst();
    if (!user || user.status !== "active") return 0;
    const owned = await db.selectFrom("workspaces").select("id").where("owner_id", "=", userId).execute();
    const channels = (await Promise.all(owned.map((w) => getSubscribedChannels(w.id, payload.event)))).flat();
    const ctx = await sendContext();
    const email = user.email.toLowerCase();
    const covered = channels.some((c) => c.type === "email" && (c.config as NotifyConfigByType["email"]).to.toLowerCase().split(",").some((a) => a.trim() === email));
    const jobs = channels.map(async (channel) => {
      const result = await sendNotification(channel, payload, ctx);
      await logNotification({ workspaceId: channel.workspaceId, channelId: channel.id, event: payload.event, ok: result.ok, error: result.error ?? null }).catch(() => undefined);
      return result.ok;
    });
    if (!covered) jobs.push(withTimeout(sendEmail({ to: user.email }, payload, ctx), ctx.timeoutMs + 500).then((r) => r.ok));
    return (await Promise.all(jobs)).filter(Boolean).length;
  } catch (error) {
    console.error("[dialzen] account notification failed:", error);
    return 0;
  }
}

/** The dashboard's "Send test" button: a sample notification to one channel (logged as event "test"). */
export async function sendTestNotification(channel: NotifyChannelRecord, workspace: { id: number; name: string }): Promise<SendResult> {
  const ctx = await sendContext();
  const payload = await buildNotifyPayload(workspace, "test", `This is a test notification from ${ctx.siteName}. If you can read this, notifications to "${channel.name}" work.`, {
    example: "Real notifications tell you when a call fails, a caller books an appointment or opts out, a campaign finishes or the wallet balance runs low.",
  });
  const result = await sendNotification(channel, payload, ctx);
  await logNotification({ workspaceId: workspace.id, channelId: channel.id, event: "test", ok: result.ok, error: result.error ?? null }).catch(() => undefined);
  return result;
}
