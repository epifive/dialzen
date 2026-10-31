import type { NotifyEvent, NotifyPayload } from "@/voice/types";

/**
 * Turns a NotifyPayload into the title, summary and fields every notification channel shows.
 * Notifications are written in English (like the webhook payload), whatever the dashboard language.
 */

/** "2026-10-16 14:05 UTC" */
export function humanTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function humanNumber(value: number | string | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export const EVENT_COLORS: Record<NotifyEvent, string> = {
  call_completed: "#16a34a",
  call_failed: "#dc2626",
  booking_made: "#16a34a",
  opt_out: "#d97706",
  campaign_finished: "#a21caf",
  low_balance: "#dc2626",
  agent_sync_failed: "#dc2626",
  outbound_decided: "#a21caf",
  quota_warning: "#d97706",
  quota_reached: "#dc2626",
  test: "#1d5bd8",
};

const SUBJECT_PREFIX: Record<NotifyEvent, string> = {
  call_completed: "Call completed",
  call_failed: "Call failed",
  booking_made: "New booking",
  opt_out: "Opt-out",
  campaign_finished: "Campaign finished",
  low_balance: "Low balance",
  agent_sync_failed: "Agent not synced",
  outbound_decided: "Outbound calling",
  quota_warning: "Usage 80%",
  quota_reached: "Usage limit reached",
  test: "Test",
};

/** True for events that need attention (red / "Attention" styling). */
export function isProblem(event: NotifyEvent): boolean {
  return event === "call_failed" || event === "low_balance" || event === "agent_sync_failed" || event === "quota_reached";
}

export interface NotificationText {
  /** One-line headline, e.g. "A call failed in Acme". */
  title: string;
  /** Email subject, e.g. "[Call failed] Acme". */
  subject: string;
  /** One or two sentences with the essentials. */
  summary: string;
  /** Label/value pairs shown as fields. */
  facts: Array<[string, string]>;
  color: string;
  /** Label of the link button ("Open dashboard"). */
  linkLabel: string;
}

/** Fact labels for well-known `data` keys (other keys are shown as they are). */
const FACT_LABELS: Record<string, string> = {
  agent: "Agent",
  caller: "Caller",
  callee: "Called number",
  number: "Number",
  direction: "Direction",
  duration: "Duration",
  status: "Status",
  outcome: "Outcome",
  summary: "Summary",
  appointment: "Appointment",
  campaign: "Campaign",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  balance: "Balance",
  threshold: "Alert below",
  decision: "Decision",
  note: "Note",
  reason: "Reason",
  error: "Error",
  used: "Used",
  limit: "Plan limit",
  quota: "Limit",
};

export function describeNotification(p: NotifyPayload, siteName: string): NotificationText {
  const ws = p.workspace?.name || "your workspace";
  const facts: Array<[string, string]> = [];
  if (p.workspace) facts.push(["Workspace", p.workspace.name]);
  for (const [key, value] of Object.entries(p.data)) {
    if (key === "example") continue;
    facts.push([FACT_LABELS[key] ?? key, typeof value === "number" ? humanNumber(value) : String(value)]);
  }
  let title: string;
  switch (p.event) {
    case "call_completed":
      title = `A call was completed in ${ws}`;
      break;
    case "call_failed":
      title = `A call failed in ${ws}`;
      break;
    case "booking_made":
      title = `A caller booked an appointment in ${ws}`;
      break;
    case "opt_out":
      title = `A caller asked not to be called again (${ws})`;
      break;
    case "campaign_finished":
      title = `A campaign finished in ${ws}`;
      break;
    case "low_balance":
      title = `The call credit balance of ${ws} is low`;
      break;
    case "agent_sync_failed":
      title = `An agent couldn't be updated at the voice provider (${ws})`;
      break;
    case "outbound_decided":
      title = `Outbound calling was ${p.data.decision === "approved" ? "approved" : "not approved"} for ${ws}`;
      break;
    case "quota_warning":
      title = "You have used 80% of your plan's limit";
      break;
    case "quota_reached":
      title = "You have reached your plan's limit";
      break;
    case "test":
      title = `Test notification from ${siteName}`;
      break;
  }
  return {
    title,
    subject: `[${SUBJECT_PREFIX[p.event]}] ${p.event === "test" || !p.workspace ? siteName : p.workspace.name}`,
    summary: p.message,
    facts,
    color: EVENT_COLORS[p.event],
    linkLabel: "Open dashboard",
  };
}

/** Plain-text body used by email (and as a fallback elsewhere). */
export function notificationPlainText(p: NotifyPayload, siteName: string): string {
  const t = describeNotification(p, siteName);
  return [t.title, "", t.summary, "", ...t.facts.map(([k, v]) => `${k}: ${v}`), "", `${t.linkLabel}: ${p.url}`, "", `— ${siteName}`].join("\n");
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface SendContext {
  siteName: string;
  /** Webhooks may point at private/internal addresses (env ALLOW_PRIVATE_WEBHOOKS=1). */
  allowPrivate: boolean;
  timeoutMs: number;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}
