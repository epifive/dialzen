import "server-only";
import type { NotifyPayload, NotifyConfigByType } from "@/voice/types";
import { describeNotification, type SendContext, type SendResult } from "./format";
import { deliver } from "./webhook";

/** Discord webhook: one embed with the event colour. */
export async function sendDiscord(config: NotifyConfigByType["discord"], payload: NotifyPayload, ctx: SendContext): Promise<SendResult> {
  if (!config.webhookUrl) return { ok: false, error: "No Discord webhook URL configured" };
  const t = describeNotification(payload, ctx.siteName);
  const body = {
    username: ctx.siteName.replace(/discord/gi, "").trim().slice(0, 80) || "Notifications",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: t.title.slice(0, 256),
        url: /^https?:\/\//.test(payload.url) ? payload.url : undefined,
        description: t.summary.slice(0, 2000),
        color: Number.parseInt(t.color.slice(1), 16),
        fields: t.facts.slice(0, 10).map(([name, value]) => ({ name, value: value.slice(0, 1000) || "-", inline: true })),
        timestamp: payload.sent_at,
        footer: { text: ctx.siteName.slice(0, 200) },
      },
    ],
  };
  return deliver(config.webhookUrl, JSON.stringify(body), ctx, {}, (status) =>
    status === 401 || status === 404 ? `Discord rejected the webhook (HTTP ${status}). Check the webhook URL.` : undefined,
  );
}
