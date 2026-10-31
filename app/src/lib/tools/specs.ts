import crypto from "node:crypto";
import type { ToolConfigByKind, ToolKind, ToolParameter, ToolSpec } from "@/voice/types";

/**
 * What the LLM sees of each tool kind: the function parameters and a default description. Server
 * tools (Cal.com, Google Calendar, webhook, Google Sheets) call our endpoint
 * /api/voice/tools/<toolId>?agent=<agentId> with a per-agent-and-tool secret header; transfer and
 * end_call are provider-native system tools (no endpoint). Pure.
 */

export const TOOL_SECRET_HEADER = "x-dialzen-tool-secret";
export const TOOL_SIGNATURE_HEADER = "x-dialzen-tool-signature";

const p = (name: string, type: ToolParameter["type"], description: string, required = false): ToolParameter => ({ name, type, description, required });

const BOOKING_PARAMS: ToolParameter[] = [
  p("action", "string", 'Either "availability" (list free times) or "book" (book one of the free times).', true),
  p("date", "string", "The day to check, YYYY-MM-DD (availability). Defaults to today."),
  p("start", "string", "The chosen start time as returned by availability (ISO-8601), required to book."),
  p("name", "string", "The caller's full name (book)."),
  p("email", "string", "The caller's email address, if given (book)."),
  p("phone", "string", "The caller's phone number (book)."),
  p("notes", "string", "Short notes for the booking (reason, service)."),
];

export const DEFAULT_TOOL_DESCRIPTIONS: Record<ToolKind, string> = {
  cal_com: 'Checks free appointment times and books one. First call with action "availability" and a date, read the options to the caller, then call with action "book" and the chosen start time.',
  google_calendar: 'Checks free appointment times in the calendar and books one. First call with action "availability" and a date, then with action "book" and the chosen start time.',
  webhook: "Sends the collected details to the business system and returns its answer.",
  google_sheets: "Saves the caller's details as a new row in a spreadsheet.",
  transfer: "Transfers the call to a human team member when the caller asks for a person or the agent cannot help.",
  end_call: "Ends the call politely when the conversation is over.",
};

/** The LLM parameters of a tool (webhook tools define their own). */
export function toolParameters<K extends ToolKind>(kind: K, config: ToolConfigByKind[K]): ToolParameter[] {
  switch (kind) {
    case "cal_com":
    case "google_calendar":
      return BOOKING_PARAMS;
    case "webhook":
      return (config as ToolConfigByKind["webhook"]).parameters;
    case "google_sheets": {
      const cols = (config as ToolConfigByKind["google_sheets"]).columns.filter((c) => !/^(call_id|caller_number|date|time)$/.test(c));
      return cols.map((c) => p(c.replace(/[^a-z0-9_]/gi, "_").toLowerCase().slice(0, 40) || "value", "string", `Value of the "${c}" column.`));
    }
    default:
      return [];
  }
}

/** Per agent and tool secret (HMAC of the agent's tool_secret), sent back by the provider in X-Dialzen-Tool-Secret. */
export function toolSecretFor(agentToolSecret: string, toolId: number): string {
  return crypto.createHmac("sha256", agentToolSecret).update(`tool:${toolId}`).digest("base64url");
}

/** Our endpoint of a server tool. */
export function toolUrl(baseUrl: string, toolId: number, agentId: number): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/voice/tools/${toolId}?agent=${agentId}`;
}

export interface ToolRowLike {
  id: number;
  kind: ToolKind;
  name: string;
  description: string;
}

/** The ToolSpec handed to adapters. */
export function buildToolSpec<K extends ToolKind>(tool: ToolRowLike & { kind: K }, config: ToolConfigByKind[K], agent: { id: number; toolSecret: string }, baseUrl: string): ToolSpec {
  const server = tool.kind !== "transfer" && tool.kind !== "end_call";
  const transfer = tool.kind === "transfer" ? (config as ToolConfigByKind["transfer"]) : null;
  let description = tool.description || DEFAULT_TOOL_DESCRIPTIONS[tool.kind];
  if (tool.kind === "end_call") {
    const extra = (config as ToolConfigByKind["end_call"]).instructions;
    if (extra) description = `${description} ${extra}`.slice(0, 1000);
  }
  return {
    id: tool.id,
    kind: tool.kind,
    name: tool.name,
    description,
    parameters: toolParameters(tool.kind, config),
    url: server ? toolUrl(baseUrl, tool.id, agent.id) : "",
    secret: server ? toolSecretFor(agent.toolSecret, tool.id) : "",
    transfer: transfer ? { number: transfer.number, mode: transfer.mode, whisper: transfer.whisper } : null,
  };
}
