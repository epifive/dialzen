import "server-only";
import crypto from "node:crypto";
import { postJson, ToolInputError } from "@/lib/net/ssrf";
import { signatureHeaders } from "@/lib/webhook-signature";
import type { NotifyPayload, NotifyConfigByType } from "@/voice/types";
import type { SendContext, SendResult } from "./format";

/** POST JSON through the SSRF-safe helper and turn the outcome into a SendResult. */
export async function deliver(
  url: string,
  body: string,
  ctx: SendContext,
  headers: Record<string, string> = {},
  describeStatus?: (status: number) => string | undefined,
): Promise<SendResult> {
  try {
    const status = await postJson(url, body, { timeoutMs: ctx.timeoutMs, headers, anyPort: true, allowPrivate: ctx.allowPrivate });
    if (status >= 200 && status < 300) return { ok: true };
    return { ok: false, error: describeStatus?.(status) ?? `The endpoint answered HTTP ${status}` };
  } catch (error) {
    if (error instanceof ToolInputError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "Sending failed" };
  }
}


/**
 * Generic webhook: the NotifyPayload as JSON. Headers:
 *   X-Dialzen-Event:     the event (call_failed, booking_made, …)
 *   X-Dialzen-Delivery:  a unique id per delivery
 *   X-Dialzen-Timestamp: unix seconds
 *   X-Dialzen-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")> (when the
 *                        channel has a secret; src/lib/webhook-signature.ts)
 */
export async function sendWebhook(config: NotifyConfigByType["webhook"], payload: NotifyPayload, ctx: SendContext): Promise<SendResult> {
  if (!config.url) return { ok: false, error: "No webhook URL configured" };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "X-Dialzen-Event": payload.event,
    "X-Dialzen-Delivery": crypto.randomUUID(),
    ...signatureHeaders(body, config.secret ?? ""),
  };
  return deliver(config.url, body, ctx, headers);
}
