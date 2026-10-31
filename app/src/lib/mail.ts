import "server-only";
import { getSettings, type Settings } from "./settings";

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. A simple HTML version is generated from it unless `html` is given. */
  text: string;
  replyTo?: string;
  /** Complete HTML document (e.g. email reports); defaults to one built from `text`. */
  html?: string;
}

export function mailConfigured(settings: Settings): boolean {
  return settings.mail_enabled && Boolean(settings.smtp_host && settings.mail_from_address);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function toHtml(text: string, settings: Settings): string {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:' + settings.primary_color + '">$1</a>')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f6f7f5;font-family:Arial,Helvetica,sans-serif;color:#18201d">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-size:20px;font-weight:bold;margin:0 0 24px">${escapeHtml(settings.site_name)}</p>
<div style="background:#ffffff;border:1px solid #dde3df;border-radius:12px;padding:24px;font-size:15px;line-height:1.6">${body}</div>
</div></body></html>`;
}

/** Send an email using the SMTP settings from Admin → Email. Throws when sending fails. */
export async function sendMail(message: MailMessage): Promise<void> {
  const settings = await getSettings();
  if (!mailConfigured(settings)) throw new Error("Email is not configured. Set up SMTP in Admin → Settings → Email.");
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: settings.smtp_host,
    port: Number(settings.smtp_port) || 587,
    secure: settings.smtp_secure,
    auth: settings.smtp_user ? { user: settings.smtp_user, pass: settings.smtp_pass } : undefined,
  });
  await transport.sendMail({
    from: { name: settings.mail_from_name || settings.site_name, address: settings.mail_from_address },
    to: message.to,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
    html: message.html ?? toHtml(message.text, settings),
  });
}
