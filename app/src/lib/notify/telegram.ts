import "server-only";
import type { NotifyPayload, NotifyConfigByType } from "@/voice/types";
import { describeNotification, escapeHtml, type SendContext, type SendResult } from "./format";
import { deliver } from "./webhook";

/** Telegram Bot API sendMessage with HTML formatting. */
export async function sendTelegram(config: NotifyConfigByType["telegram"], payload: NotifyPayload, ctx: SendContext): Promise<SendResult> {
  if (!config.botToken || !config.chatId) return { ok: false, error: "Bot token and chat ID are required" };
  const t = describeNotification(payload, ctx.siteName);
  const lines = [
    `<b>${escapeHtml(t.title)}</b>`,
    escapeHtml(t.summary),
    "",
    ...t.facts.map(([k, v]) => `<b>${escapeHtml(k)}:</b> ${escapeHtml(v)}`),
  ];
  if (/^https?:\/\//.test(payload.url)) lines.push("", `<a href="${escapeHtml(payload.url)}">${escapeHtml(t.linkLabel)}</a>`);
  const body = { chat_id: config.chatId, text: lines.join("\n").slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true };
  // The Bot API host is public; never use the private-address exception for it.
  return deliver(`https://api.telegram.org/bot${config.botToken}/sendMessage`, JSON.stringify(body), { ...ctx, allowPrivate: false }, {}, (status) => {
    if (status === 401 || status === 404) return "Telegram rejected the bot token";
    if (status === 400) return "Telegram rejected the message. Check the chat ID";
    if (status === 403) return "The bot can't write to this chat. Start a chat with the bot or add it to the group first";
    if (status === 429) return "Telegram is rate-limiting the bot";
    return undefined;
  });
}
