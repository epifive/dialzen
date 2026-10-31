import "server-only";
import { isDemoMode } from "@/lib/config";
import { mailConfigured, sendMail } from "@/lib/mail";
import { getSettings } from "@/lib/settings";
import type { NotifyPayload, NotifyConfigByType } from "@/voice/types";
import { notificationPlainText, describeNotification, type SendContext, type SendResult } from "./format";

export async function sendEmail(config: NotifyConfigByType["email"], payload: NotifyPayload, ctx: SendContext): Promise<SendResult> {
  if (!config.to) return { ok: false, error: "No email address configured" };
  const settings = await getSettings();
  // The public demo never sends email to the addresses visitors type in: delivery is simulated.
  if (isDemoMode() && !mailConfigured(settings)) return { ok: true };
  if (!mailConfigured(settings)) return { ok: false, error: "Email is not configured on this platform (Admin → Settings → Email)" };
  const t = describeNotification(payload, ctx.siteName);
  try {
    // sendMail builds the HTML version (links, paragraphs, branding) from the plain text.
    await sendMail({ to: config.to, subject: t.subject, text: notificationPlainText(payload, ctx.siteName) });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sending failed" };
  }
}
