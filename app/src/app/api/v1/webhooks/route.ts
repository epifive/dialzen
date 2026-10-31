import { apiError, apiJson } from "@/lib/api-guard";
import { apiCreated, readApiJson } from "@/lib/api-v1";
import { createNotifyChannel, getNotifyChannel, getNotifyChannels, MAX_NOTIFY_CHANNELS } from "@/lib/notify-channels";
import { normalizeNotifyConfig, str } from "@/voice/normalize";
import { NOTIFY_EVENTS, type NotifyEvent } from "@/voice/types";
import { v1Guard } from "../_shared";
import { unprocessable, webhookJson } from "../_serialize";

export const dynamic = "force-dynamic";

/**
 * Outgoing webhooks for n8n, Zapier, Make… They are the workspace's notification channels of type
 * "webhook": a signed JSON POST (X-Dialzen-Signature, HMAC-SHA256 of the body with `secret`) for
 * each subscribed event, e.g. call_completed with the call's summary and extracted data.
 */

/** Event names accepted as "call_completed" or "call.completed". */
function eventsFrom(v: unknown): NotifyEvent[] | null {
  if (v === undefined) return ["call_completed"];
  if (!Array.isArray(v)) return null;
  const out: NotifyEvent[] = [];
  for (const raw of v) {
    const e = String(raw).replace(/\./g, "_");
    if (!(NOTIFY_EVENTS as readonly string[]).includes(e) || e === "test") return null;
    if (!out.includes(e as NotifyEvent)) out.push(e as NotifyEvent);
  }
  return out.length ? out : null;
}

/** GET /api/v1/webhooks */
export async function GET(request: Request) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const channels = (await getNotifyChannels(guard.workspace.id)).filter((c) => c.type === "webhook");
  return apiJson({ data: channels.map(webhookJson), events: NOTIFY_EVENTS.filter((e) => e !== "test") });
}

/** POST /api/v1/webhooks: { url, secret?, events?: ["call_completed", …], name? } (default event: call_completed). */
export async function POST(request: Request) {
  const guard = await v1Guard(request, { capability: "settings.manage", write: true });
  if (!guard.ok) return guard.response;
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const config = normalizeNotifyConfig("webhook", { url: body.url, secret: body.secret });
  if (!config.url) return unprocessable("url must be an http(s) URL.");
  const events = eventsFrom(body.events);
  if (!events) return unprocessable(`events must be a list of: ${NOTIFY_EVENTS.filter((e) => e !== "test").join(", ")}.`);
  if ((await getNotifyChannels(guard.workspace.id)).length >= MAX_NOTIFY_CHANNELS) return apiError(409, `A workspace can have up to ${MAX_NOTIFY_CHANNELS} notification channels.`);
  const id = await createNotifyChannel(guard.workspace.id, guard.user.id, "webhook", str(body.name, "", 120) || "API webhook", config, events);
  const channel = await getNotifyChannel(guard.workspace.id, id);
  return apiCreated(channel ? webhookJson(channel) : { id });
}
