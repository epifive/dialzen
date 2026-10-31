"use server";

import { z } from "zod";
import { guardAdmin } from "@/lib/admin";
import { cleanupExpiredSessions } from "@/lib/auth/session";
import { sendMail } from "@/lib/mail";
import { clearSettingsCache, getSettings } from "@/lib/settings";
import type { FormState } from "@/app/actions/types";

export async function clearCaches(): Promise<FormState> {
  const guard = await guardAdmin({ allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  clearSettingsCache();
  return { success: "Caches cleared. Settings are reloaded from the database." };
}

export async function pruneSessions(): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  await cleanupExpiredSessions();
  return { success: "Expired sessions and reset links removed." };
}

export async function sendTestEmail(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const to = z.email().safeParse(formData.get("to"));
  if (!to.success) return { error: "Enter a valid email address." };
  const settings = await getSettings();
  try {
    await sendMail({
      to: to.data,
      subject: `Test email from ${settings.site_name}`,
      text: `This is a test email from ${settings.site_name}.\n\nIf you can read this, your SMTP settings work.`,
    });
  } catch (e) {
    return { error: e instanceof Error ? `Sending failed: ${e.message}` : "Sending failed." };
  }
  return { success: `Test email sent to ${to.data}.` };
}
