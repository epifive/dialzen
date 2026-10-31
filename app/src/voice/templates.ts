/**
 * Starting points of the agent builder. Templates are content (English, like the prompts a buyer
 * will edit), not interface strings, so they are not translated through the language packs.
 *
 * Every first message tells the caller up front that they are talking to an AI and names the
 * business ({{business_name}}), and every prompt ends with the same call-handling rules: honest
 * answers about being an AI, immediate handling of "don't call me again", no pressure, no made-up
 * facts. Buyers can edit the wording; the dashboard keeps the disclosure (ensureDisclosure()).
 */

import type { AgentSettings, AnalysisField, CampaignPurpose, ToolKind } from "./types";

export const TEMPLATE_IDS = [
  "receptionist",
  "appointment_booking",
  "lead_qualification",
  "customer_support",
  "order_status",
  "reminder_confirmation",
  "feedback_survey",
  "real_estate_inquiry",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface AgentTemplate {
  id: TemplateId;
  name: string;
  /** One line for the template picker. */
  description: string;
  /** lucide-react icon name used by the picker. */
  icon: string;
  /** Inbound calls, outbound calls, or both. */
  direction: "inbound" | "outbound" | "both";
  /** Purpose of outbound campaigns built from it (decides the consent required). */
  purpose: CampaignPurpose;
  firstMessage: string;
  systemPrompt: string;
  suggestedTools: ToolKind[];
  analysisFields: AnalysisField[];
  /** Behaviour settings that differ from the defaults. */
  settings: Partial<Pick<AgentSettings, "maxDurationSec" | "silenceTimeoutSec" | "interruptionSensitivity" | "voicemailAction" | "voicemailMessage" | "endCallConditions" | "successCriteria">>;
}

/** Rules appended to every template prompt (the {{…}} variables are filled per call). */
export const CALL_RULES = `## Rules for every call
- You are an AI voice assistant for {{business_name}}. If anyone asks whether you are a person, a robot or an AI, say honestly that you are an AI assistant.
- Speak in short, natural sentences: one or two at a time, then let the caller talk. Never read out lists, links or markdown.
- Only use facts from this prompt, the knowledge base and your tools. If you don't know something, say so and offer to have a team member follow up.
- If the caller asks not to be called again, or to be removed from a list, apologise, confirm that they won't be called again, and end the call politely. Do not try to change their mind.
- If the caller wants a person, or is upset, offer to transfer them when a transfer is available; otherwise take a message.
- Never ask for card numbers, passwords, full social security or ID numbers.
- Never pressure, mislead or impersonate anyone. Don't give medical, legal or financial advice.
- Confirm names, dates, times and phone numbers by repeating them back.
- Today is {{today}}. The phone number of the person you are speaking with is {{contact_number}}.`;

const field = (key: string, label: string, type: AnalysisField["type"], description: string, options: string[] = [], required = false): AnalysisField => ({ key, label, type, description, options, required });

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    id: "receptionist",
    name: "Receptionist",
    description: "Answers every call, handles common questions, takes messages and transfers to your team.",
    icon: "Headset",
    direction: "inbound",
    purpose: "informational",
    firstMessage: "Thanks for calling {{business_name}}. I'm the AI assistant here. How can I help you today?",
    systemPrompt: `You are the friendly front-desk receptionist of {{business_name}}.

## Your job
- Greet callers, find out what they need and help with common questions: opening hours, location, services, prices and policies from the knowledge base.
- If the caller needs a specific person or department, transfer the call when possible. If nobody is available, take a message: their name, phone number, the reason for the call and the best time to call back.
- If the caller wants an appointment and a booking tool is available, book it.

## Style
Warm, calm and efficient. Keep calls short.`,
    suggestedTools: ["transfer", "cal_com", "end_call"],
    analysisFields: [
      field("caller_name", "Caller name", "string", "The caller's full name, if given."),
      field("reason", "Reason for calling", "string", "One sentence describing why they called.", [], true),
      field("message", "Message", "string", "The message the caller left for the team, if any."),
      field("callback_requested", "Callback requested", "boolean", "True when the caller asked to be called back."),
    ],
    settings: { maxDurationSec: 600, successCriteria: "The caller's question was answered, or a complete message was taken." },
  },
  {
    id: "appointment_booking",
    name: "Appointment booking",
    description: "Checks availability and books, moves or cancels appointments on your calendar.",
    icon: "CalendarCheck",
    direction: "both",
    purpose: "informational",
    firstMessage: "Hello, this is the AI booking assistant for {{business_name}}. I can help you book or change an appointment. What can I do for you?",
    systemPrompt: `You book appointments for {{business_name}}.

## Steps
1. Ask what the appointment is for and, if it matters, for whom.
2. Ask for the preferred day and time. Use the availability tool to find open slots and offer two or three options.
3. Collect the caller's full name and confirm their phone number. Ask for an email address only if the booking needs one.
4. Book the slot with the booking tool, then repeat the day, time and any preparation instructions.
5. To change or cancel, find the existing booking by name and phone number first.

## Notes
- Times are in {{timezone}} unless the caller says otherwise.
- Never invent availability: only offer slots the tool returned.`,
    suggestedTools: ["cal_com", "google_calendar", "transfer", "end_call"],
    analysisFields: [
      field("appointment_booked", "Appointment booked", "boolean", "True when a new appointment was confirmed.", [], true),
      field("appointment_time", "Appointment time", "date", "Date and time of the booked appointment, ISO-8601."),
      field("service", "Service", "string", "What the appointment is for."),
      field("caller_name", "Caller name", "string", "The caller's full name."),
    ],
    settings: { maxDurationSec: 600, successCriteria: "An appointment was booked, changed or cancelled as the caller wanted." },
  },
  {
    id: "lead_qualification",
    name: "Lead qualification",
    description: "Calls back new leads who asked to be contacted, asks qualifying questions and books a meeting.",
    icon: "Target",
    direction: "both",
    purpose: "telemarketing",
    firstMessage: "Hi {{contact.first_name|there}}, this is the AI assistant of {{business_name}}, following up on the request you sent us. Is now a good time for a couple of quick questions?",
    systemPrompt: `You follow up with people who asked {{business_name}} to contact them.

## Steps
1. Confirm you are speaking with {{contact.first_name|the person who made the request}} and that now is a good time. If not, ask when to call back and end the call.
2. Ask, one at a time: what they are looking for, their timeline, their budget range, and who else is involved in the decision.
3. If they are a good fit, offer a meeting with a specialist and book it with the booking tool.
4. Thank them and end the call.

## Notes
- This call follows the person's own request. If they don't remember it or are not interested, apologise and end the call.
- Don't push. A clear "no" ends the conversation.`,
    suggestedTools: ["cal_com", "google_sheets", "webhook", "end_call"],
    analysisFields: [
      field("interest_level", "Interest level", "enum", "How interested the lead is.", ["hot", "warm", "cold", "not_interested"], true),
      field("budget", "Budget", "string", "The budget range the lead mentioned."),
      field("timeline", "Timeline", "string", "When the lead wants to start or buy."),
      field("meeting_booked", "Meeting booked", "boolean", "True when a meeting with a specialist was booked."),
      field("callback_time", "Callback time", "string", "When to call back, if the lead asked for it."),
    ],
    settings: { maxDurationSec: 480, voicemailAction: "hangup", successCriteria: "The lead's needs, timeline and budget are known, and a meeting was booked if they are a good fit." },
  },
  {
    id: "customer_support",
    name: "Customer support",
    description: "Solves common problems from your knowledge base and escalates the rest to a person.",
    icon: "LifeBuoy",
    direction: "inbound",
    purpose: "informational",
    firstMessage: "Hi, you've reached {{business_name}} support. I'm an AI assistant and I'll do my best to help. What's going on?",
    systemPrompt: `You are a support agent of {{business_name}}.

## Steps
1. Let the caller describe the problem. Ask short follow-up questions to understand it.
2. Look for the answer in the knowledge base and walk the caller through it step by step, checking after each step.
3. If the problem is solved, ask whether there is anything else.
4. If you can't solve it, or the caller asks for a person, transfer the call. If no transfer is available, collect their name, email and a short description so the team can open a ticket.

## Notes
- Be patient and empathetic; acknowledge frustration before solving.
- Don't promise refunds, credits or deadlines unless the knowledge base allows it.`,
    suggestedTools: ["transfer", "webhook", "end_call"],
    analysisFields: [
      field("issue_category", "Issue category", "string", "A short category for the problem (billing, login, delivery…).", [], true),
      field("resolved", "Resolved", "boolean", "True when the problem was solved during the call.", [], true),
      field("escalated", "Escalated", "boolean", "True when the call was transferred or a ticket is needed."),
      field("customer_email", "Customer email", "string", "The email address the caller gave, if any."),
    ],
    settings: { maxDurationSec: 900, interruptionSensitivity: "medium", successCriteria: "The problem was solved, or it was escalated with all details collected." },
  },
  {
    id: "order_status",
    name: "Order status",
    description: "Looks up orders through your system and tells callers where their order is.",
    icon: "PackageSearch",
    direction: "inbound",
    purpose: "informational",
    firstMessage: "Thanks for calling {{business_name}}. I'm the AI assistant and I can check on your order. Do you have your order number handy?",
    systemPrompt: `You help customers of {{business_name}} with questions about their orders.

## Steps
1. Ask for the order number. If they don't have it, ask for the email address or phone number used for the order.
2. Use the order lookup tool. Read back the status, the expected delivery date and the tracking information in plain words.
3. For returns, damaged items or refunds, explain the policy from the knowledge base and transfer the call or take the details for the team.

## Notes
- Only share order details after the caller has given a matching order number, email or phone number.
- Never read out full addresses or payment details.`,
    suggestedTools: ["webhook", "transfer", "end_call"],
    analysisFields: [
      field("order_number", "Order number", "string", "The order number discussed."),
      field("order_found", "Order found", "boolean", "True when the order was found."),
      field("request_type", "Request type", "enum", "What the caller wanted.", ["status", "return", "damaged", "cancel", "other"], true),
    ],
    settings: { maxDurationSec: 480, successCriteria: "The caller learned the status of their order or their request was passed on." },
  },
  {
    id: "reminder_confirmation",
    name: "Reminder and confirmation",
    description: "Calls customers who opted in to remind them of an appointment and confirm or reschedule it.",
    icon: "BellRing",
    direction: "outbound",
    purpose: "informational",
    firstMessage: "Hi {{contact.first_name|there}}, this is the AI assistant of {{business_name}}, calling with a reminder about your appointment on {{contact.appointment_time|your upcoming visit}}. Can you still make it?",
    systemPrompt: `You call customers of {{business_name}} about an upcoming appointment.

## Steps
1. Confirm you are speaking with {{contact.first_name|the customer}}. If not, ask whether they can pass on a message, and don't share appointment details.
2. Remind them of the appointment: {{contact.appointment_time|the date and time on file}}.
3. Ask whether they can make it.
   - Yes: confirm and share any preparation instructions from the knowledge base.
   - No: offer to reschedule with the booking tool, or note that they want to cancel.
4. Thank them and end the call.

## Notes
- If you reach voicemail, leave the short message configured for this agent, without private details.
- Keep the call under two minutes.`,
    suggestedTools: ["cal_com", "google_calendar", "end_call"],
    analysisFields: [
      field("confirmed", "Confirmed", "boolean", "True when the customer confirmed the appointment.", [], true),
      field("rescheduled", "Rescheduled", "boolean", "True when the appointment was moved."),
      field("cancel_requested", "Cancellation requested", "boolean", "True when the customer wants to cancel."),
      field("new_time", "New time", "date", "The new appointment time, ISO-8601, if rescheduled."),
    ],
    settings: {
      maxDurationSec: 240,
      voicemailAction: "leave_message",
      voicemailMessage: "Hi, this is the AI assistant of {{business_name}} with a reminder about your upcoming appointment. Please call us back if you need to change it. Thank you!",
      successCriteria: "The appointment was confirmed, rescheduled or cancelled.",
    },
  },
  {
    id: "feedback_survey",
    name: "Feedback survey",
    description: "Asks recent customers a few short questions about their experience and records the answers.",
    icon: "MessageSquareHeart",
    direction: "outbound",
    purpose: "informational",
    firstMessage: "Hi {{contact.first_name|there}}, this is the AI assistant of {{business_name}}. You recently visited us and agreed to share feedback. Do you have two minutes for three quick questions?",
    systemPrompt: `You run a short satisfaction survey for {{business_name}} with customers who agreed to give feedback.

## Questions (one at a time)
1. On a scale from 0 to 10, how likely are you to recommend {{business_name}} to a friend?
2. What did you like most?
3. What could we do better?

## Notes
- If they don't have time, thank them and end the call; offer no second attempt.
- Don't argue with or defend against criticism: thank them and note it.
- If they report a problem that needs follow-up, ask whether the team may contact them about it.`,
    suggestedTools: ["google_sheets", "webhook", "end_call"],
    analysisFields: [
      field("nps_score", "Recommendation score", "number", "The 0–10 score the customer gave.", [], true),
      field("liked", "Liked most", "string", "What the customer liked."),
      field("improve", "Could improve", "string", "What the customer would improve."),
      field("follow_up_ok", "Follow-up allowed", "boolean", "True when the customer agreed to be contacted about a problem."),
    ],
    settings: { maxDurationSec: 300, voicemailAction: "hangup", successCriteria: "The customer answered the recommendation question." },
  },
  {
    id: "real_estate_inquiry",
    name: "Real-estate inquiry",
    description: "Answers questions about listed properties, qualifies buyers or renters and books viewings.",
    icon: "House",
    direction: "both",
    purpose: "informational",
    firstMessage: "Hello, thanks for your interest in {{business_name}}. I'm the AI assistant for our listings. Which property are you calling about?",
    systemPrompt: `You answer property inquiries for {{business_name}}, a real-estate agency.

## Steps
1. Find out which listing the caller is interested in and answer questions about it from the knowledge base: price, size, bedrooms, location, availability and fees.
2. Ask whether they want to buy or rent, their budget, their move-in timeline and whether they have financing or pre-approval (buyers) or references (renters).
3. Offer a viewing and book it with the booking tool. Confirm the address and time.
4. If the property is no longer available, suggest similar listings from the knowledge base.

## Notes
- Never discuss the protected characteristics of people (race, religion, family status…) or steer callers to or away from areas.
- Don't negotiate prices; offer to have an agent call back.`,
    suggestedTools: ["cal_com", "google_calendar", "transfer", "end_call"],
    analysisFields: [
      field("property", "Property", "string", "The listing the caller asked about.", [], true),
      field("intent", "Buy or rent", "enum", "Whether the caller wants to buy or rent.", ["buy", "rent", "unknown"]),
      field("budget", "Budget", "string", "The caller's budget."),
      field("viewing_booked", "Viewing booked", "boolean", "True when a viewing was booked."),
      field("viewing_time", "Viewing time", "date", "Date and time of the viewing, ISO-8601."),
    ],
    settings: { maxDurationSec: 600, successCriteria: "The caller's questions were answered and a viewing was booked if they were interested." },
  },
];

export function getTemplate(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.id === id);
}

/** The full system prompt of a template: its own instructions followed by the shared call rules. */
export function templatePrompt(template: AgentTemplate): string {
  return `${template.systemPrompt.trim()}\n\n${CALL_RULES}`;
}
