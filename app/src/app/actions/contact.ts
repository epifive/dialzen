"use server";

import { z } from "zod";
import { getDb, now } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { mailConfigured, sendMail } from "@/lib/mail";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import type { FormState } from "./types";

export async function sendContactMessage(_prev: FormState, formData: FormData): Promise<FormState> {
  const [settings, t] = await Promise.all([getSettings(), getT()]);
  if (!settings.contact_enabled) return { error: t("contact.err.disabled") };

  // Honeypot field: real visitors never see or fill it. Answer exactly like a real success.
  if (formData.get("website")) return { success: t("contact.sent") };

  const ip = await clientIp();
  if (!rateLimit(`contact:${ip}`, 3, 30 * 60_000)) {
    return { error: t("contact.err.tooMany") };
  }

  const parsed = z
    .object({
      name: z.string().trim().min(2, t("contact.err.name")).max(120),
      email: z.email(t("auth.err.invalidEmail")).max(190),
      subject: z.string().trim().min(3, t("contact.err.subject")).max(255),
      message: z.string().trim().min(10, t("contact.err.message")).max(5000),
    })
    .safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      subject: formData.get("subject"),
      message: formData.get("message"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = await getDb();
  await db
    .insertInto("contact_messages")
    .values({ ...parsed.data, ip: ip.slice(0, 64), is_read: 0, created_at: now() })
    .execute();

  if (mailConfigured(settings)) {
    // The message is already saved, so a mail failure must not fail the form.
    await sendMail({
      to: settings.site_email,
      replyTo: parsed.data.email,
      subject: `[${settings.site_name}] ${parsed.data.subject}`,
      text: `New message from ${parsed.data.name} <${parsed.data.email}>:\n\n${parsed.data.message}`,
    }).catch(() => undefined);
  }
  return { success: t("contact.sent") };
}
