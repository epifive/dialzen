"use server";

import { redirect } from "next/navigation";
import { guardWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/messages";
import { sendTestNotification } from "@/lib/notify";
import { createNotifyChannel, deleteNotifyChannel, getNotifyChannel, getNotifyChannels, MAX_NOTIFY_CHANNELS, updateNotifyChannel } from "@/lib/notify-channels";
import { rateLimit } from "@/lib/rate-limit";
import { isNotifyChannelType, normalizeNotifyConfig, notifyConfigProblem } from "@/voice/normalize";
import type { NotifyChannelType } from "@/voice/types";
import type { FormState } from "../types";
import { idOf, str } from "./helpers";

/** Notification channels of a workspace (Workspace → Notifications). Managing them needs settings.manage. */

function configFromForm(formData: FormData) {
  return {
    to: str(formData.get("to")),
    url: str(formData.get("url")),
    secret: str(formData.get("secret")),
    webhookUrl: str(formData.get("webhookUrl")),
    botToken: str(formData.get("botToken")),
    chatId: str(formData.get("chatId")),
  };
}

/** notifyConfigProblem(), translated. */
function configError(type: NotifyChannelType, config: unknown, t: Translator): string {
  if (!notifyConfigProblem(type, config)) return "";
  if (type === "email") return t("dash.err.channelEmail");
  if (type === "webhook") return t("dash.err.channelWebhook");
  if (type === "telegram") return t("dash.err.channelTelegram");
  return t("dash.err.channelIncoming");
}

const base = (wid: number) => `/dashboard/w/${wid}/notifications`;

export async function saveNotifyChannelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "settings.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const wid = guard.workspace.id;
  const editing = str(formData.get("channel_id")) !== "";
  const existing = editing ? await getNotifyChannel(wid, idOf(formData.get("channel_id"))) : undefined;
  if (editing && !existing) return { error: t("dash.notify.err.notFound") };
  const rawType = existing?.type ?? str(formData.get("type"));
  if (!isNotifyChannelType(rawType)) return { error: t("dash.notify.err.type") };
  const type: NotifyChannelType = rawType;

  const name = str(formData.get("name")).trim();
  if (name.length > 120) return { error: t("dash.notify.err.name") };
  const config = normalizeNotifyConfig(type, configFromForm(formData));
  const problem = configError(type, config, t);
  if (problem) return { error: problem };
  const events = formData.getAll("events").map(String);
  if (!events.length) return { error: t("dash.notify.err.events") };
  const label = name || t(`dash.notify.type.${type}`);

  if (existing) {
    await updateNotifyChannel(existing, { name: label, config, events, isActive: formData.get("active") === "on" });
    redirect(`${base(wid)}?saved=1`);
  }
  if ((await getNotifyChannels(wid)).length >= MAX_NOTIFY_CHANNELS) return { error: t("dash.notify.err.limit", { n: MAX_NOTIFY_CHANNELS }) };
  await createNotifyChannel(wid, guard.user.id, type, label, config, events);
  redirect(`${base(wid)}?created=1`);
}

export async function toggleNotifyChannelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "settings.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const channel = await getNotifyChannel(guard.workspace.id, idOf(formData.get("channel_id")));
  if (!channel) return { error: t("dash.notify.err.notFound") };
  await updateNotifyChannel(channel, { isActive: formData.get("active") === "1" });
  return {};
}

export async function deleteNotifyChannelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "settings.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const channel = await getNotifyChannel(guard.workspace.id, idOf(formData.get("channel_id")));
  if (!channel) return { error: t("dash.notify.err.notFound") };
  await deleteNotifyChannel(channel);
  redirect(`${base(guard.workspace.id)}?deleted=1`);
}

/** "Send test": deliver a sample notification to a saved channel. */
export async function testNotifyChannelAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "settings.manage", allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const channel = await getNotifyChannel(guard.workspace.id, idOf(formData.get("channel_id")));
  if (!channel) return { error: t("dash.notify.err.notFound") };
  if (!rateLimit(`dz-notify-test:${guard.user.id}`, 6, 60_000)) return { error: t("dash.notify.err.rate") };
  const result = await sendTestNotification(channel, guard.workspace);
  return result.ok ? { success: t("dash.notify.testSent") } : { error: t("dash.notify.testFailed", { error: result.error ?? t("dash.notify.err.generic") }) };
}
