import { localDay, zonedTimeToUtc } from "@/voice/normalize";

/**
 * Dialogue banks of the voice demo seed (demo-voice.ts): call scripts per agent in English,
 * Spanish, Arabic and Hindi, with the tool calls a booking makes (availability, then book), the
 * summary, the sentiment and the fields the agent's post-call analysis extracts. Pure and
 * deterministic for a given rand(); demo-voice.ts turns the steps into a timed transcript.
 *
 * Summaries are in English (as the providers' analysis writes them) whatever the call language.
 */

export type Lang = "en" | "es" | "ar" | "hi";

export interface ToolStep {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  ok?: boolean;
}

/** a = agent line, c = caller line, t = tool call, p = pause (seconds of silence, hold or typing). */
export type Step = ["a" | "c", string] | ["t", ToolStep] | ["p", number];

export interface Script {
  steps: Step[];
  outcome: string;
  endReason: "caller_hangup" | "agent_hangup" | "transferred" | "opt_out";
  sentiment: "positive" | "neutral" | "negative";
  summary: string;
  extracted: Record<string, unknown>;
}

export interface Person {
  first: string;
  last: string;
  name: string;
  phone: string;
  email: string;
}

/** Opening hours by ISO weekday: [open, close] in local decimal hours. */
export type Hours = Partial<Record<number, [number, number]>>;

export interface ScriptCtx {
  r: () => number;
  person: Person;
  tz: string;
  /** The agent's first message, variables already filled in. */
  greeting: string;
  /** Call start (ms). */
  at: number;
  hours: Hours;
  tools: { book?: string; crm?: string; transfer?: string; lookup?: string };
  /** Reminder calls: the appointment on file (ms). */
  appointment?: number | null;
}

export type Scenario = (c: ScriptCtx) => Script;

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
const chance = (r: () => number, p: number) => r() < p;

// ── Dates, slots and tool steps ──

const LOCALE: Record<Lang, string> = { en: "en-US", es: "es-MX", ar: "ar-AE-u-nu-latn", hi: "hi-IN" };

export function dayText(ms: number, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(ms);
}

export function timeText(ms: number, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(ms);
}

function weekdayText(ms: number, tz: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: tz, weekday: "long" }).format(ms);
}

/** "Thursday, October 22, 10:30 AM": the label the Cal.com tool returns (English, like the runtime). */
export function slotLabel(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const isoWeekday = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
};

const token = (r: () => number, n: number) => Array.from({ length: n }, () => "abcdefghijkmnopqrstuvwxyz23456789"[Math.floor(r() * 33)]).join("");

export interface Booking {
  day: string;
  dayText: string;
  weekday: string;
  options: Array<{ ms: number; text: string }>;
  chosen: { ms: number; text: string; iso: string };
  avail: ToolStep;
  book: ToolStep;
}

/**
 * Free times on one open day `minDays`–`maxDays` after the call (same day allowed with 0), the
 * availability tool step and the booking of one of them.
 */
export function booking(c: ScriptCtx, lang: Lang, o: { tool: string; minDays: number; maxDays: number; part?: "am" | "pm" | "any"; name: string; notes: string; step?: number }): Booking {
  const today = localDay(c.at, c.tz);
  const start = o.minDays + Math.floor(c.r() * (o.maxDays - o.minDays + 1));
  const step = o.step ?? 0.5;
  let day = addDays(today, start);
  let all: number[] = [];
  // The first open day from there with free times (at least 90 minutes after the call).
  for (let i = 0; i < 21; i++) {
    const open = c.hours[isoWeekday(day)];
    if (open) {
      const [y, m, d] = day.split("-").map(Number);
      const lo = o.part === "pm" ? Math.max(open[0], 13) : open[0];
      const hi = o.part === "am" ? Math.min(open[1], 12) : open[1];
      for (let h = lo; h + 0.5 <= hi; h += step) {
        const ms = zonedTimeToUtc({ year: y, month: m, day: d, hour: Math.floor(h), minute: Math.round((h % 1) * 60) }, c.tz);
        if (ms > c.at + 90 * 60_000) all.push(ms);
      }
      if (all.length) break;
    }
    day = addDays(day, 1);
  }
  if (!all.length) all = [c.at + 2 * 86_400_000];
  // A few free times spread over the day, like a real calendar.
  const options = [...new Set(Array.from({ length: Math.min(3, all.length) }, () => pick(c.r, all)))].sort((a, b) => a - b);
  const chosenMs = pick(c.r, options);
  const iso = new Date(chosenMs).toISOString();
  const dayEn = dayText(options[0], c.tz, "en");
  return {
    day,
    dayText: dayText(chosenMs, c.tz, lang),
    weekday: weekdayText(chosenMs, c.tz, lang),
    options: options.map((ms) => ({ ms, text: timeText(ms, c.tz, lang) })),
    chosen: { ms: chosenMs, text: timeText(chosenMs, c.tz, lang), iso },
    avail: {
      name: o.tool,
      args: { action: "availability", date: day },
      result: {
        message: `Free times on ${dayEn}: ${options.map((ms) => timeText(ms, c.tz, "en")).join(", ")}. Time zone ${c.tz}.`,
        date: day,
        timezone: c.tz,
        slots: options.map((ms) => ({ start: new Date(ms).toISOString(), label: slotLabel(ms, c.tz) })),
      },
    },
    book: {
      name: o.tool,
      args: { action: "book", start: iso, name: o.name, phone: c.person.phone, notes: o.notes },
      result: { message: `Booked for ${slotLabel(chosenMs, c.tz)}.`, booking_id: `bk_${token(c.r, 14)}`, start: iso },
    },
  };
}

const list = (items: string[], and: string) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`);

/** "(415) 555-0123" for US numbers. */
export function spokenPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

function crm(c: ScriptCtx, reason: string, extra: Record<string, unknown> = {}): ToolStep[] {
  if (!c.tools.crm) return [];
  return [{ name: c.tools.crm, args: { caller_name: c.person.name, phone: c.person.phone, reason, ...extra }, result: { message: "Saved to the patient record.", record_id: `pt_${10_000 + Math.floor(c.r() * 89_999)}` } }];
}

function transfer(c: ScriptCtx, reason: string, to: string): ToolStep {
  return { name: c.tools.transfer ?? "transfer_call", args: { reason }, result: { message: `Transferring the call to ${to}.` } };
}

const tools = (steps: ToolStep[]): Step[] => steps.map((t): Step => ["t", t]);

// ── Brightline Dental (San Francisco) ──

export const DENTAL = {
  dentists: ["Dr. Anika Patel", "Dr. James Nguyen"],
  hygienists: ["Maria", "Kevin", "Alyssa"],
  insuranceIn: ["Delta Dental PPO", "Cigna Dental PPO", "MetLife PDP", "Aetna Dental PPO", "Guardian Dental"],
  insuranceOut: ["Kaiser Dental HMO", "DeltaCare USA HMO"],
  hours: { 1: [8, 18], 2: [8, 18], 3: [8, 18], 4: [8, 19], 5: [8, 16], 6: [9, 14] } as Hours,
  staffLine: "+14155550188",
};

const fdBookCleaning: Scenario = (c) => {
  const { r, person: p } = c;
  const hyg = pick(r, DENTAL.hygienists);
  const ins = pick(r, DENTAL.insuranceIn);
  const part = chance(r, 0.5) ? "am" : "pm";
  const b = booking(c, "en", { tool: c.tools.book!, minDays: 2, maxDays: 12, part, name: p.name, notes: "Cleaning and exam" });
  return {
    steps: [
      ["a", c.greeting],
      ["c", pick(r, ["Hi, I'd like to book a cleaning. It's been about six months.", "Hello, I need to schedule my next cleaning, please.", "Hi there, I got a reminder that I'm due for a cleaning. Can I book that?"])],
      ["a", "Happy to help with that. Can I have your full name so I can find your file?"],
      ["c", `Sure, it's ${p.name}.`],
      ["a", `Thanks, ${p.first}, I found your file. Do mornings or afternoons usually work better for you?`],
      ["c", part === "am" ? "Mornings are best, before work if possible." : "Afternoons, ideally after two."],
      ["p", 2],
      ["t", b.avail],
      ["a", `I have ${list(b.options.map((o) => o.text), "or")} on ${b.dayText}. Which one works for you?`],
      ["c", `${b.chosen.text} works for me.`],
      ...tools([b.book, ...crm(c, "Cleaning booked", { appointment_time: b.chosen.iso })]),
      ["a", `You're all set for a cleaning and exam with ${hyg} on ${b.dayText} at ${b.chosen.text}. We have your ${ins} on file, and you'll get a text confirmation shortly. Anything else I can help with?`],
      ["c", "No, that's it. Thank you!"],
      ["a", `You're welcome, ${p.first}. See you on ${b.weekday}. Have a great day!`],
    ],
    outcome: "booked",
    endReason: chance(r, 0.6) ? "caller_hangup" : "agent_hangup",
    sentiment: "positive",
    summary: `${p.name} booked a cleaning and exam with ${hyg} for ${b.dayText} at ${b.chosen.text}. Insurance on file: ${ins}.`,
    extracted: { caller_name: p.name, reason: "Book a cleaning and exam", appointment_booked: true, appointment_time: b.chosen.iso, service: "Cleaning and exam", new_patient: false, insurance: ins },
  };
};

const fdNewPatient: Scenario = (c) => {
  const { r, person: p } = c;
  const ins = pick(r, DENTAL.insuranceIn);
  const doc = pick(r, DENTAL.dentists);
  const b = booking(c, "en", { tool: c.tools.book!, minDays: 3, maxDays: 10, part: "pm", name: p.name, notes: "New patient exam, x-rays and cleaning" });
  return {
    steps: [
      ["a", c.greeting],
      ["c", pick(r, ["Hi, I just moved to the area and I'm looking for a dentist. Are you taking new patients?", "Hello, are you accepting new patients? A coworker recommended you."])],
      ["a", "We are, welcome! A first visit is a new patient exam with x-rays and a cleaning, and it takes about 90 minutes. Do you have dental insurance?"],
      ["c", `Yes, I have ${ins}.`],
      ["p", 2],
      ["a", `Great, we're in network with ${ins}, so the exam and cleaning are usually covered. Without insurance, the new patient visit is $210. Would you like me to find a time?`],
      ["c", "Yes please. Do you have anything next week, maybe in the afternoon?"],
      ["p", 2],
      ["t", b.avail],
      ["a", `On ${b.dayText} I have ${list(b.options.map((o) => o.text), "or")}.`],
      ["c", `Let's do ${b.chosen.text}. My name is ${p.name}.`],
      ["a", `Thanks, ${p.first}. And is ${spokenPhone(p.phone)} the best number to reach you?`],
      ["c", "Yes, that's my cell."],
      ...tools([b.book, ...crm(c, "New patient visit booked", { appointment_time: b.chosen.iso, new_patient: true })]),
      ["a", `Perfect. You're booked for a new patient visit with ${doc} on ${b.dayText} at ${b.chosen.text}. Please arrive ten minutes early, and we'll text you a link to the intake forms. Anything else?`],
      ["c", "Is there parking nearby?"],
      ["a", "Yes, the Union Street garage is right next door, and we validate two hours."],
      ["c", "Great, thanks so much."],
      ["a", "You're welcome. We look forward to meeting you!"],
    ],
    outcome: "booked",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `New patient ${p.name} (${ins}) booked a new patient exam, x-rays and cleaning with ${doc} for ${b.dayText} at ${b.chosen.text}. Asked about parking.`,
    extracted: { caller_name: p.name, reason: "New patient looking for a dentist", appointment_booked: true, appointment_time: b.chosen.iso, service: "New patient exam, x-rays and cleaning", new_patient: true, insurance: ins },
  };
};

const fdToothache: Scenario = (c) => {
  const { r, person: p } = c;
  const doc = pick(r, DENTAL.dentists);
  if (chance(r, 0.3) && c.tools.transfer) {
    return {
      steps: [
        ["a", c.greeting],
        ["c", "Hi, I have a really bad toothache and my face is swollen. I don't know what to do."],
        ["a", "I'm sorry you're in pain. Is the swelling spreading, or is it hard to swallow or breathe?"],
        ["c", "It's pretty swollen on the left side and it's a bit hard to swallow."],
        ["a", "That needs attention right away. I'm going to transfer you to our front desk team now so a dental assistant can help you. If your breathing gets worse, please call 911."],
        ["c", "Okay, thank you."],
        ["t", transfer(c, "Swelling and difficulty swallowing", "the front desk team")],
        ["a", "Transferring you now. Please stay on the line."],
      ],
      outcome: "transferred",
      endReason: "transferred",
      sentiment: "negative",
      summary: `${p.first} called with severe tooth pain, facial swelling and difficulty swallowing. Transferred to the front desk team as an urgent case.`,
      extracted: { caller_name: p.name, reason: "Toothache with swelling and difficulty swallowing", appointment_booked: false, service: "Emergency" },
    };
  }
  const b = booking(c, "en", { tool: c.tools.book!, minDays: 0, maxDays: 1, part: "any", name: p.name, notes: "Emergency exam, toothache" });
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Hi, I've had a bad toothache since last night. Can someone see me soon?"],
      ["a", "I'm sorry you're in pain. Is there any swelling in your face, or a fever?"],
      ["c", "A little swelling, no fever."],
      ["a", "Thank you. We keep a few emergency slots every day. Let me check what's open."],
      ["p", 2],
      ["t", b.avail],
      ["a", `I can get you in on ${b.dayText} at ${list(b.options.map((o) => o.text), "or")} with ${doc}. The emergency exam is $95 and includes an x-ray. Which time works?`],
      ["c", `${b.chosen.text}, please. I'm ${p.name}.`],
      ...tools([b.book, ...crm(c, "Emergency exam booked", { appointment_time: b.chosen.iso })]),
      ["a", `You're booked for an emergency exam at ${b.chosen.text}, ${p.first}. If the swelling gets worse or you get a fever before then, please go to urgent care. Is this the best number to reach you?`],
      ["c", "Yes. Thank you so much."],
      ["a", "Feel better soon. We'll see you then."],
    ],
    outcome: "booked",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `${p.name} called with a toothache and mild swelling since last night. Booked an emergency exam with ${doc} on ${b.dayText} at ${b.chosen.text} ($95 incl. x-ray).`,
    extracted: { caller_name: p.name, reason: "Toothache, mild swelling", appointment_booked: true, appointment_time: b.chosen.iso, service: "Emergency exam", new_patient: false },
  };
};

const fdReschedule: Scenario = (c) => {
  const { r, person: p } = c;
  const old = c.at + (2 + Math.floor(r() * 4)) * 86_400_000;
  const oldDay = dayText(old, c.tz, "en");
  const b = booking(c, "en", { tool: c.tools.book!, minDays: 6, maxDays: 13, part: "am", name: p.name, notes: `Rescheduled from ${oldDay}` });
  return {
    steps: [
      ["a", c.greeting],
      ["c", `Hi, this is ${p.name}. I have an appointment on ${oldDay}, but something came up at work. Can I move it?`],
      ["a", `Of course, ${p.first}. I see your cleaning on ${oldDay}. When would you like to come in instead?`],
      ["c", "Anything the following week, ideally early in the morning."],
      ["p", 2],
      ["t", b.avail],
      ["a", `I have ${list(b.options.map((o) => o.text), "or")} on ${b.dayText}.`],
      ["c", `${b.chosen.text} is perfect.`],
      ...tools([b.book, ...crm(c, "Appointment rescheduled", { appointment_time: b.chosen.iso })]),
      ["a", `Done. I've moved your appointment to ${b.dayText} at ${b.chosen.text} and released the old time. You'll get an updated text confirmation.`],
      ["c", "Great, thanks for making that easy."],
      ["a", "Anytime. Have a good day!"],
    ],
    outcome: "booked",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `${p.name} moved a cleaning from ${oldDay} to ${b.dayText} at ${b.chosen.text} because of a work conflict.`,
    extracted: { caller_name: p.name, reason: "Reschedule an appointment", appointment_booked: true, appointment_time: b.chosen.iso, service: "Cleaning and exam", new_patient: false },
  };
};

const fdInsurance: Scenario = (c) => {
  const { r, person: p } = c;
  const inNetwork = chance(r, 0.75);
  const ins = inNetwork ? pick(r, DENTAL.insuranceIn) : pick(r, DENTAL.insuranceOut);
  if (inNetwork && chance(r, 0.35)) {
    const b = booking(c, "en", { tool: c.tools.book!, minDays: 3, maxDays: 10, part: "any", name: p.name, notes: "Cleaning and exam" });
    return {
      steps: [
        ["a", c.greeting],
        ["c", `Hi, I wanted to check if you take ${ins}.`],
        ["a", `Yes, we're in network with ${ins}. Cleanings and exams are usually covered at 100 percent, but it depends on your plan. Would you like to book a visit?`],
        ["c", "Actually yes, let's do that."],
        ["a", "Great. Can I have your full name?"],
        ["c", `${p.name}.`],
        ["p", 2],
      ["t", b.avail],
        ["a", `Thanks, ${p.first}. I have ${list(b.options.map((o) => o.text), "or")} on ${b.dayText}.`],
        ["c", `${b.chosen.text}, please.`],
        ...tools([b.book, ...crm(c, "Cleaning booked", { appointment_time: b.chosen.iso })]),
        ["a", `You're booked for ${b.dayText} at ${b.chosen.text}. Please bring your insurance card and a photo ID. See you then!`],
        ["c", "Thank you!"],
      ],
      outcome: "booked",
      endReason: "caller_hangup",
      sentiment: "positive",
      summary: `${p.name} asked whether ${ins} is accepted (in network) and booked a cleaning for ${b.dayText} at ${b.chosen.text}.`,
      extracted: { caller_name: p.name, reason: `Insurance question: ${ins}`, appointment_booked: true, appointment_time: b.chosen.iso, service: "Cleaning and exam", insurance: ins },
    };
  }
  return {
    steps: [
      ["a", c.greeting],
      ["c", `Hi, I wanted to check if you take ${ins}.`],
      inNetwork
        ? ["a", `Yes, we're in network with ${ins}. Preventive care like cleanings and exams is usually covered at 100 percent, but it depends on your plan. Would you like me to book a visit?`]
        : ["a", `I'm sorry, we don't accept HMO plans like ${ins}. We can give you an itemized receipt to submit yourself, and we also take HSA and FSA cards and CareCredit.`],
      ["c", "Okay. Do I need to bring anything to the first visit?"],
      ["a", "Just your insurance card and a photo ID. If you can, fill in the intake form online before your visit."],
      ["c", inNetwork ? "Okay, I'll check my calendar and call back. Thanks." : "Got it, I'll think about it. Thank you."],
      ["a", "Sounds good. Have a great day!"],
    ],
    outcome: "completed",
    endReason: "caller_hangup",
    sentiment: inNetwork ? "positive" : "neutral",
    summary: inNetwork ? `Caller asked whether ${ins} is accepted (yes, in network) and what to bring. Will call back to book.` : `Caller asked about ${ins}; the clinic doesn't accept HMO plans. Explained receipts, HSA/FSA and CareCredit.`,
    extracted: { reason: `Insurance question: ${ins}`, appointment_booked: false, insurance: ins },
  };
};

const fdHours: Scenario = (c) => {
  const { r } = c;
  return {
    steps: [
      ["a", c.greeting],
      ["c", pick(r, ["Hi, what are your hours on Saturday?", "Hello, are you open on Saturdays?", "Hi, quick question, how late are you open during the week?"])],
      ["a", "On Saturdays we're open from 9 AM to 2 PM. During the week we're open 8 to 6, and until 7 on Thursdays. On Fridays we close at 4."],
      ["c", "And where exactly are you? Is there parking?"],
      ["a", "We're at 1840 Union Street in San Francisco, between Laguna and Octavia. The Union Street garage next door is validated for two hours."],
      ["c", "Great, that's all I needed."],
      ["a", "Happy to help. Have a nice day!"],
    ],
    outcome: "completed",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: "Caller asked about Saturday and weekday hours, the address and parking. All answered from the knowledge base.",
    extracted: { reason: "Opening hours and parking", appointment_booked: false },
  };
};

const fdPrice: Scenario = (c) => {
  const { person: p } = c;
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Hi, how much is teeth whitening?"],
      ["a", "In-office whitening is $399 and takes about 90 minutes. Take-home trays with gel are $249. We start with a quick check to make sure whitening is right for you."],
      ["c", "Does insurance cover any of that?"],
      ["a", "Whitening is cosmetic, so insurance usually doesn't cover it. Many patients pay with an HSA or FSA card, or spread it with CareCredit."],
      ["c", "Okay. Could someone call me back about the take-home option?"],
      ["a", "Of course. Can I have your name?"],
      ["c", `${p.name}.`],
      ...tools(crm(c, "Callback about take-home whitening")),
      ["a", `Thanks, ${p.first}. I've asked the team to call you back about take-home whitening at this number today or tomorrow.`],
      ["c", "Perfect, thanks."],
    ],
    outcome: "callback",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `${p.name} asked about whitening prices (in-office $399, take-home trays $249) and insurance. Wants a callback about the take-home option.`,
    extracted: { caller_name: p.name, reason: "Whitening prices", appointment_booked: false, service: "Whitening", callback_requested: true, message: "Call back about take-home whitening trays ($249)." },
  };
};

const fdCancel: Scenario = (c) => {
  const { r, person: p } = c;
  const old = c.at + (3 + Math.floor(r() * 6)) * 86_400_000;
  const oldDay = dayText(old, c.tz, "en");
  return {
    steps: [
      ["a", c.greeting],
      ["c", `Hi, I need to cancel my appointment on ${oldDay}. My name is ${p.name}.`],
      ["a", `I'm sorry to hear that, ${p.first}. I see your appointment on ${oldDay}. Would you like to reschedule now, or just cancel?`],
      ["c", "Just cancel for now. I'm traveling for a few weeks, I'll call when I'm back."],
      ...tools(crm(c, "Appointment canceled, traveling")),
      ["a", "No problem, it's canceled. Since it's more than 24 hours ahead, there's no cancellation fee. We'll be happy to see you when you're back."],
      ["c", "Thanks, bye."],
    ],
    outcome: "completed",
    endReason: "caller_hangup",
    sentiment: "neutral",
    summary: `${p.name} canceled the appointment on ${oldDay} (traveling for a few weeks). No fee; will call to rebook.`,
    extracted: { caller_name: p.name, reason: "Cancel an appointment", appointment_booked: false, message: "Canceled; traveling, will call back to rebook." },
  };
};

const fdBilling: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "Hi, I got a bill for my last visit and I think my insurance should have covered it. Can I talk to someone?"],
    ["a", "I understand, and I'm sorry for the confusion. Billing questions are best handled by our front desk team, who can see the claim details. Shall I transfer you now?"],
    ["c", "Yes, please."],
    ["t", transfer(c, "Billing question about an insurance claim", "the front desk team")],
    ["a", "Transferring you now. One moment please."],
  ],
  outcome: "transferred",
  endReason: "transferred",
  sentiment: chance(c.r, 0.5) ? "negative" : "neutral",
  summary: "Caller disputed a bill they expected insurance to cover. Transferred to the front desk team for the claim details.",
  extracted: { reason: "Question about a bill and an insurance claim", appointment_booked: false },
});

const fdMessage: Scenario = (c) => {
  const { r, person: p } = c;
  const doc = pick(r, DENTAL.dentists);
  return {
    steps: [
      ["a", c.greeting],
      ["c", `Hi, I had a crown done last week with ${doc} and it feels a bit high when I bite. Can I leave a message?`],
      ["a", "Of course, I'm sorry it's bothering you. Is it painful, or just uncomfortable when you bite down?"],
      ["c", "Just uncomfortable, no real pain."],
      ["a", `Thanks. A bite adjustment usually takes just a few minutes. I'll pass this to ${doc}'s assistant so they can call you to set up a quick visit. What's your name?`],
      ["c", `${p.name}.`],
      ...tools(crm(c, "Message for the dentist: crown feels high")),
      ["a", `Got it, ${p.first}. Someone will call you back at this number before the end of the day.`],
      ["c", "Thank you."],
    ],
    outcome: "message_taken",
    endReason: "caller_hangup",
    sentiment: "neutral",
    summary: `${p.name} says the crown placed last week by ${doc} feels high when biting (no pain). Message passed to the dentist's assistant for a callback today.`,
    extracted: { caller_name: p.name, reason: "Crown feels high when biting", appointment_booked: false, callback_requested: true, message: `For ${doc}: crown from last week feels high, no pain. Wants a quick bite adjustment.` },
  };
};

const fdAfterHours: Scenario = (c) => {
  const { r, person: p } = c;
  const b = booking(c, "en", { tool: c.tools.book!, minDays: 1, maxDays: 2, part: "am", name: p.name, notes: "Chipped front tooth" });
  if (chance(r, 0.45)) {
    return {
      steps: [
        ["a", c.greeting],
        ["c", "Hi, I know you're closed, but my son knocked his front tooth playing basketball. It's a little loose."],
        ["a", "I'm sorry that happened. Is it bleeding a lot, or is the tooth completely knocked out?"],
        ["c", "No, it's not bleeding much, just a bit loose."],
        ["a", "Okay. Have him avoid biting with it and rinse gently with water. I'll leave an urgent message so the on-call dentist calls you back tonight. Can I have your name?"],
        ["c", `${p.name}.`],
        ...tools(crm(c, "After-hours: loose front tooth (child)")),
        ["a", `Thanks, ${p.first}. The on-call dentist will call you at this number within the hour. If the tooth comes out, keep it in milk and call back right away.`],
        ["c", "Thank you, that helps."],
      ],
      outcome: "message_taken",
      endReason: "caller_hangup",
      sentiment: "neutral",
      summary: `After hours: ${p.name}'s son loosened a front tooth playing basketball (little bleeding). Urgent message left for the on-call dentist to call back tonight.`,
      extracted: { caller_name: p.name, reason: "After hours: child's loose front tooth", appointment_booked: false, callback_requested: true, message: "On-call dentist to call back tonight about a loose front tooth (child)." },
    };
  }
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Hi, I know you're probably closed, but I chipped a front tooth at dinner. Is that an emergency?"],
      ["a", "I'm sorry that happened. If there's no severe pain or bleeding, it usually isn't an emergency, and we can repair it at our next opening. Would you like the first appointment?"],
      ["c", "Yes, that would be great."],
      ["p", 2],
      ["t", b.avail],
      ["a", `The earliest is ${b.dayText} at ${list(b.options.map((o) => o.text), "or")}.`],
      ["c", `${b.chosen.text}. My name is ${p.name}.`],
      ...tools([b.book, ...crm(c, "Chipped tooth repair booked", { appointment_time: b.chosen.iso })]),
      ["a", `You're booked for ${b.dayText} at ${b.chosen.text}, ${p.first}. Until then, avoid biting hard foods with that tooth. Good night!`],
      ["c", "Thanks, good night."],
    ],
    outcome: "booked",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `After-hours call: ${p.name} chipped a front tooth at dinner (no severe pain). Booked the first opening, ${b.dayText} at ${b.chosen.text}.`,
    extracted: { caller_name: p.name, reason: "Chipped front tooth", appointment_booked: true, appointment_time: b.chosen.iso, service: "Bonding repair" },
  };
};

const fdHangup: Scenario = (c) => ({
  steps: [["a", c.greeting], ["p", 4]],
  outcome: "completed",
  endReason: "caller_hangup",
  sentiment: "neutral",
  summary: "The caller hung up during the greeting.",
  extracted: {},
});

export const FRONT_DESK: Array<[Scenario, number]> = [
  [fdBookCleaning, 10],
  [fdNewPatient, 6],
  [fdToothache, 6],
  [fdReschedule, 4],
  [fdInsurance, 14],
  [fdHours, 13],
  [fdPrice, 9],
  [fdCancel, 6],
  [fdBilling, 8],
  [fdMessage, 10],
  [fdHangup, 3],
];
export const FRONT_DESK_AFTER_HOURS: Array<[Scenario, number]> = [
  [fdAfterHours, 7],
  [fdHours, 3],
  [fdMessage, 2],
  [fdHangup, 1],
];
/** Web widget visitors ask more about prices, insurance and booking. */
export const FRONT_DESK_WEB: Array<[Scenario, number]> = [
  [fdBookCleaning, 4],
  [fdNewPatient, 4],
  [fdInsurance, 7],
  [fdPrice, 5],
  [fdHours, 4],
];

// ── Spanish line ──

const esBook: Scenario = (c) => {
  const { r, person: p } = c;
  const b = booking(c, "es", { tool: c.tools.book!, minDays: 2, maxDays: 10, part: chance(r, 0.5) ? "am" : "pm", name: p.name, notes: "Limpieza y revisión (paciente de habla hispana)" });
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Hola, buenos días. Quisiera hacer una cita para una limpieza."],
      ["a", "Con gusto. ¿Me puede dar su nombre completo, por favor?"],
      ["c", `Sí, soy ${p.name}.`],
      ["a", `Gracias, ${p.first}. ¿Prefiere por la mañana o por la tarde?`],
      ["c", "Por la mañana, si es posible."],
      ["p", 2],
      ["t", b.avail],
      ["a", `Tengo disponible el ${b.dayText} a las ${list(b.options.map((o) => o.text), "o")}. ¿Cuál le queda mejor?`],
      ["c", `A las ${b.chosen.text}, por favor.`],
      ["t", b.book],
      ["a", `Listo. Su cita de limpieza y revisión es el ${b.dayText} a las ${b.chosen.text}. Le enviaremos un mensaje de texto para confirmar. ¿Algo más en que le pueda ayudar?`],
      ["c", "No, eso es todo. Muchas gracias."],
      ["a", "Con mucho gusto. ¡Que tenga un buen día!"],
    ],
    outcome: "booked",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `${p.name} (Spanish) booked a cleaning and exam for ${dayText(b.chosen.ms, c.tz, "en")} at ${timeText(b.chosen.ms, c.tz, "en")}.`,
    extracted: { caller_name: p.name, reason: "Book a cleaning", appointment_booked: true, appointment_time: b.chosen.iso },
  };
};

const esInsurance: Scenario = (c) => {
  const { r } = c;
  const ins = pick(r, DENTAL.insuranceIn);
  return {
    steps: [
      ["a", c.greeting],
      ["c", `Hola, quería saber si aceptan el seguro ${ins}.`],
      ["a", `Sí, trabajamos con ${ins}. Las limpiezas y revisiones normalmente están cubiertas, pero depende de su plan.`],
      ["c", "¿Y cuánto cuesta una limpieza sin seguro?"],
      ["a", "Sin seguro, la limpieza con revisión cuesta 145 dólares. También aceptamos tarjetas HSA y FSA, y CareCredit."],
      ["c", "Muy bien. ¿Tienen estacionamiento?"],
      ["a", "Sí, el estacionamiento de Union Street está al lado y validamos dos horas."],
      ["c", "Perfecto, voy a llamar para hacer la cita. Gracias."],
      ["a", "Con gusto. ¡Hasta pronto!"],
    ],
    outcome: "completed",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `Spanish-speaking caller asked whether ${ins} is accepted (yes), the cash price of a cleaning ($145) and parking. Will call back to book.`,
    extracted: { reason: `Insurance question: ${ins}`, appointment_booked: false },
  };
};

const esReschedule: Scenario = (c) => {
  const { r, person: p } = c;
  const old = c.at + (1 + Math.floor(r() * 3)) * 86_400_000;
  const b = booking(c, "es", { tool: c.tools.book!, minDays: 5, maxDays: 12, part: "pm", name: p.name, notes: "Cita cambiada" });
  return {
    steps: [
      ["a", c.greeting],
      ["c", `Hola, habla ${p.name}. Tengo una cita el ${dayText(old, c.tz, "es")} pero no voy a poder ir. ¿La puedo cambiar?`],
      ["a", `Claro que sí, ${p.first}. ¿Qué día le conviene más?`],
      ["c", "La próxima semana, por la tarde."],
      ["p", 2],
      ["t", b.avail],
      ["a", `Tengo el ${b.dayText} a las ${list(b.options.map((o) => o.text), "o")}.`],
      ["c", `A las ${b.chosen.text} está bien.`],
      ["t", b.book],
      ["a", `Listo, su nueva cita es el ${b.dayText} a las ${b.chosen.text}. Ya cancelé la anterior.`],
      ["c", "Muchas gracias."],
    ],
    outcome: "booked",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `${p.name} (Spanish) moved an appointment to ${dayText(b.chosen.ms, c.tz, "en")} at ${timeText(b.chosen.ms, c.tz, "en")}.`,
    extracted: { caller_name: p.name, reason: "Reschedule an appointment", appointment_booked: true, appointment_time: b.chosen.iso },
  };
};

const esTransfer: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "Hola, tengo una pregunta sobre un plan de tratamiento y prefiero hablar con alguien de la clínica."],
    ["a", "Por supuesto. Lucía, de nuestra recepción, habla español y le puede ayudar con su plan de tratamiento. ¿Le transfiero ahora?"],
    ["c", "Sí, por favor."],
    ["t", transfer(c, "Treatment plan question, Spanish-speaking staff", "Lucía at the front desk")],
    ["a", "Le transfiero ahora mismo. Un momento, por favor."],
  ],
  outcome: "transferred",
  endReason: "transferred",
  sentiment: "neutral",
  summary: "Spanish-speaking caller had a question about a treatment plan and was transferred to Lucía at the front desk.",
  extracted: { reason: "Treatment plan question", appointment_booked: false },
});

export const SPANISH: Array<[Scenario, number]> = [
  [esBook, 5],
  [esInsurance, 4],
  [esReschedule, 2],
  [esTransfer, 2],
];

// ── Recall reminders (outbound): October recall and November reminders ──

const rcBook: Scenario = (c) => {
  const { r, person: p } = c;
  const part = chance(r, 0.5) ? "am" : "pm";
  const b = booking(c, "en", { tool: c.tools.book!, minDays: 3, maxDays: 14, part, name: p.name, notes: "Six-month cleaning (recall)" });
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Hi, yes."],
      ["a", "You're due for your six-month cleaning. Would you like to book it now?"],
      ["c", pick(r, ["Oh, yes, I've been meaning to call. Sure.", "Sure, let's do it.", "Yeah, good timing actually."])],
      ["a", "Great! Do mornings or afternoons usually work better for you?"],
      ["c", part === "am" ? "Mornings, before nine if you have it." : "Afternoons, after three if possible."],
      ["p", 2],
      ["t", b.avail],
      ["a", `I have ${list(b.options.map((o) => o.text), "or")} on ${b.dayText}.`],
      ["c", `${b.chosen.text} works.`],
      ["t", b.book],
      ["a", `You're booked for a cleaning on ${b.dayText} at ${b.chosen.text}. You'll get a text confirmation, and you can reply to it if anything changes. Thanks, ${p.first}!`],
      ["c", "Thanks, bye."],
    ],
    outcome: "booked",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `Recall call: ${p.name} booked the six-month cleaning for ${b.dayText} at ${b.chosen.text}.`,
    extracted: { appointment_booked: true, appointment_time: b.chosen.iso, confirmed: false, rescheduled: false, cancel_requested: false, callback_requested: false },
  };
};

const rcLater: Scenario = (c) => {
  const { r, person: p } = c;
  const when = pick(r, ["Thursday after five", "next week in the evening", "Saturday morning", "tomorrow at lunchtime"]);
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Hello?"],
      ["a", "You're due for your six-month cleaning. Would you like to book it now?"],
      ["c", `I'm at work right now. Can you call me back ${when}?`],
      ["a", `Of course. I've noted ${when}. Thanks, ${p.first}, and have a good day!`],
      ["c", "Thanks."],
    ],
    outcome: "callback",
    endReason: "caller_hangup",
    sentiment: "neutral",
    summary: `Recall call: ${p.name} was busy at work and asked to be called back ${when}.`,
    extracted: { appointment_booked: false, confirmed: false, callback_requested: true },
  };
};

const rcDecline: Scenario = (c) => {
  const { r, person: p } = c;
  const city = pick(r, ["Sacramento", "Portland", "San Diego", "Denver"]);
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Hi."],
      ["a", "You're due for your six-month cleaning. Would you like to book it now?"],
      ["c", `I actually just moved to ${city}, so I'll find a dentist there.`],
      ["a", "Thanks for letting us know, and good luck with the move! When you have a new dentist, just call us and we'll send your records."],
      ["c", "Will do, thanks."],
    ],
    outcome: "completed",
    endReason: "caller_hangup",
    sentiment: "neutral",
    summary: `Recall call: ${p.name} moved to ${city} and won't book. Will call to have records sent to the new dentist.`,
    extracted: { appointment_booked: false, confirmed: false, cancel_requested: false, callback_requested: false },
  };
};

const rcRelative: Scenario = (c) => {
  const { r, person: p } = c;
  const who = pick(r, ["This is his wife. He's not home right now.", "This is her husband, she's out at the moment.", "This is their roommate, they're at work."]);
  return {
    steps: [
      ["a", c.greeting],
      ["c", who],
      ["a", `No problem. Could you let ${p.first} know that Brightline Dental called about scheduling the next visit? They can call us back at (415) 555-0100.`],
      ["c", "Sure, I'll pass it on."],
      ["a", "Thank you, have a nice day!"],
    ],
    outcome: "message_taken",
    endReason: "caller_hangup",
    sentiment: "neutral",
    summary: `Recall call: reached a family member or roommate of ${p.first}; left a message to call the clinic back. No appointment details shared.`,
    extracted: { appointment_booked: false, confirmed: false, callback_requested: true },
  };
};

export const recallOptOut: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "Please take me off your list. I don't want these calls."],
    ["a", "I'm sorry for the trouble. I've removed your number, and you won't receive these calls again. Have a good day."],
  ],
  outcome: "opted_out",
  endReason: "opt_out",
  sentiment: "negative",
  summary: "The patient asked not to be called again. The number was added to the do-not-call list.",
  extracted: { appointment_booked: false, confirmed: false, opted_out: true },
});

export const RECALL: Array<[Scenario, number]> = [
  [rcBook, 58],
  [rcLater, 16],
  [rcDecline, 12],
  [rcRelative, 8],
];

const nrConfirm: Scenario = (c) => {
  const { person: p } = c;
  const appt = c.appointment ?? c.at + 10 * 86_400_000;
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Hi, yes."],
      ["a", `I'm calling to confirm your appointment on ${dayText(appt, c.tz, "en")} at ${timeText(appt, c.tz, "en")}. Can you still make it?`],
      ["c", "Yes, I'll be there."],
      ["a", "Wonderful, you're confirmed. Please arrive ten minutes early, and bring your insurance card if it changed. See you then!"],
      ["c", "Thanks, bye."],
    ],
    outcome: "booked",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `${p.name} confirmed the appointment on ${dayText(appt, c.tz, "en")} at ${timeText(appt, c.tz, "en")}.`,
    extracted: { confirmed: true, rescheduled: false, cancel_requested: false },
  };
};

const nrReschedule: Scenario = (c) => {
  const { person: p } = c;
  const appt = c.appointment ?? c.at + 10 * 86_400_000;
  const b = booking({ ...c, at: appt - 86_400_000 }, "en", { tool: c.tools.book!, minDays: 2, maxDays: 8, part: "any", name: p.name, notes: "Rescheduled by the reminder call" });
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Hello."],
      ["a", `I'm calling to confirm your appointment on ${dayText(appt, c.tz, "en")} at ${timeText(appt, c.tz, "en")}. Can you still make it?`],
      ["c", "Actually, that day doesn't work for me anymore. Can we move it?"],
      ["a", "Of course. Let me check what's available."],
      ["p", 2],
      ["t", b.avail],
      ["a", `I have ${list(b.options.map((o) => o.text), "or")} on ${b.dayText}.`],
      ["c", `${b.chosen.text}, please.`],
      ["t", b.book],
      ["a", `Done. Your appointment is now on ${b.dayText} at ${b.chosen.text}, and the old time is released. Thanks, ${p.first}!`],
      ["c", "Great, thank you."],
    ],
    outcome: "booked",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `${p.name} couldn't make ${dayText(appt, c.tz, "en")} and moved the appointment to ${b.dayText} at ${b.chosen.text}.`,
    extracted: { confirmed: false, rescheduled: true, cancel_requested: false, new_time: b.chosen.iso },
  };
};

const nrCancel: Scenario = (c) => {
  const { person: p } = c;
  const appt = c.appointment ?? c.at + 10 * 86_400_000;
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Hi."],
      ["a", `I'm calling to confirm your appointment on ${dayText(appt, c.tz, "en")} at ${timeText(appt, c.tz, "en")}. Can you still make it?`],
      ["c", "No, I need to cancel. I'll call to rebook after the holidays."],
      ["a", "No problem, I've noted the cancellation, and the team will free up the time. Thanks for letting us know!"],
      ["c", "Thanks."],
    ],
    outcome: "completed",
    endReason: "caller_hangup",
    sentiment: "neutral",
    summary: `${p.name} canceled the appointment on ${dayText(appt, c.tz, "en")} and will call to rebook after the holidays.`,
    extracted: { confirmed: false, rescheduled: false, cancel_requested: true },
  };
};

export const REMINDER: Array<[Scenario, number]> = [
  [nrConfirm, 68],
  [nrReschedule, 18],
  [nrCancel, 10],
];

// ── Harbor Realty (Dubai): Arabic property line and English lead follow-up ──

export const HARBOR_HOURS: Hours = { 1: [10, 19], 2: [10, 19], 3: [10, 19], 4: [10, 19], 5: [10, 19], 6: [10, 16] };

const arViewing: Scenario = (c) => {
  const { r, person: p } = c;
  const b = booking(c, "ar", { tool: c.tools.book!, minDays: 1, maxDays: 6, part: "any", name: p.name, notes: "Viewing: Marina Heights 2BR", step: 1 });
  return {
    steps: [
      ["a", c.greeting],
      ["c", "مرحبًا، أتصل بخصوص الشقة ذات غرفتي النوم في مارينا هايتس."],
      ["a", "اختيار ممتاز. الشقة في الطابق الثامن عشر، مساحتها 1,450 قدمًا مربعة، وسعرها 2.4 مليون درهم. هل تبحث عن الشراء أم الإيجار؟"],
      ["c", "الشراء. ميزانيتي حوالي 2.5 مليون، وسأحتاج إلى تمويل عقاري."],
      ["a", "مناسب جدًا. هل حصلت على موافقة مبدئية من البنك؟"],
      ["c", "نعم، حصلت عليها الأسبوع الماضي."],
      ["a", "رائع. هل تود حجز موعد لمعاينة الشقة؟"],
      ["c", "نعم، في أقرب وقت ممكن."],
      ["p", 2],
      ["t", b.avail],
      ["a", `لدينا مواعيد يوم ${b.dayText} الساعة ${list(b.options.map((o) => o.text), "أو")}. أيها يناسبك؟`],
      ["c", `الساعة ${b.chosen.text}. اسمي ${p.name}.`],
      ["t", b.book],
      ["a", `تم حجز المعاينة يوم ${b.dayText} الساعة ${b.chosen.text} يا ${p.first}. سيستقبلك وكيلنا في ردهة البرج، وستصلك رسالة تأكيد.`],
      ["c", "شكرًا جزيلًا."],
      ["a", "على الرحب والسعة، نراك قريبًا."],
    ],
    outcome: "booked",
    endReason: chance(r, 0.5) ? "caller_hangup" : "agent_hangup",
    sentiment: "positive",
    summary: `Buyer asked about the 2-bedroom at Marina Heights (AED 2.4M); budget about AED 2.5M with mortgage pre-approval. Viewing booked for ${dayText(b.chosen.ms, c.tz, "en")} at ${timeText(b.chosen.ms, c.tz, "en")}.`,
    extracted: { property: "Marina Heights, 2-bedroom, 18th floor (AED 2.4M)", intent: "buy", budget: "AED 2.5M (mortgage pre-approved)", viewing_booked: true, viewing_time: b.chosen.iso },
  };
};

const arRent: Scenario = (c) => {
  const { r, person: p } = c;
  const book = chance(r, 0.5);
  const b = booking(c, "ar", { tool: c.tools.book!, minDays: 1, maxDays: 5, part: "pm", name: p.name, notes: "Viewing: Palm View 1BR (rent)", step: 1 });
  const steps: Step[] = [
    ["a", c.greeting],
    ["c", "السلام عليكم، أبحث عن شقة بغرفة نوم واحدة للإيجار، رأيت إعلان بالم فيو."],
    ["a", "وعليكم السلام. شقة بالم فيو متاحة، بغرفة نوم واحدة ومطلة على البحر، والإيجار 115 ألف درهم سنويًا."],
    ["c", "هل يمكن الدفع على عدة شيكات؟"],
    ["a", "نعم، يمكن الدفع على أربعة شيكات، مع تأمين بنسبة خمسة بالمئة وعمولة الوكالة."],
  ];
  if (book) {
    steps.push(
      ["c", "ممتاز، أريد أن أراها."],
      ["p", 2],
      ["t", b.avail],
      ["a", `يمكنني حجز معاينة يوم ${b.dayText} الساعة ${list(b.options.map((o) => o.text), "أو")}.`],
      ["c", `الساعة ${b.chosen.text} مناسبة. اسمي ${p.name}.`],
      ["t", b.book],
      ["a", `تم الحجز يا ${p.first}. سنرسل لك الموقع ورقم الوكيل في رسالة.`],
      ["c", "شكرًا لك."],
    );
  } else {
    steps.push(["c", "حسنًا، سأفكر وأعود إليكم. شكرًا."], ["a", "بكل سرور، نحن في الخدمة في أي وقت."]);
  }
  return {
    steps,
    outcome: book ? "booked" : "completed",
    endReason: "caller_hangup",
    sentiment: book ? "positive" : "neutral",
    summary: book
      ? `Renter asked about the 1-bedroom at Palm View (AED 115,000/year, 4 cheques). Viewing booked for ${dayText(b.chosen.ms, c.tz, "en")} at ${timeText(b.chosen.ms, c.tz, "en")}.`
      : "Renter asked about the 1-bedroom at Palm View (AED 115,000/year) and payment in 4 cheques. Will think about it.",
    extracted: book ? { property: "Palm View Residences, 1-bedroom (rent)", intent: "rent", budget: "AED 115,000/year", viewing_booked: true, viewing_time: b.chosen.iso } : { property: "Palm View Residences, 1-bedroom (rent)", intent: "rent", budget: "AED 115,000/year", viewing_booked: false },
  };
};

const arOffPlan: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "مرحبًا، أريد معلومات عن مشروع كريك ريزيدنسز، الشقق بثلاث غرف نوم."],
    ["a", "بكل سرور. الشقق بثلاث غرف نوم في كريك ريزيدنسز تبدأ من 3.1 مليون درهم، والتسليم في الربع الأخير من 2027."],
    ["c", "وما هي خطة الدفع؟"],
    ["a", "خطة الدفع 60 بالمئة أثناء البناء و40 بالمئة عند التسليم، مع دفعة أولى بنسبة 10 بالمئة."],
    ["c", "هل يمكنكم إرسال المخططات والأسعار؟ وأفضل أن يتصل بي أحد المستشارين."],
    ["a", "بالتأكيد. سأرسل لك المخططات وقائمة الأسعار، وسيتصل بك أحد مستشارينا غدًا."],
    ["c", "ممتاز، شكرًا."],
  ],
  outcome: "callback",
  endReason: "caller_hangup",
  sentiment: "positive",
  summary: "Caller asked about 3-bedroom units at Creek Residences (from AED 3.1M, handover Q4 2027, 60/40 payment plan). Wants floor plans and a consultant callback tomorrow.",
  extracted: { property: "Creek Residences, 3-bedroom (off-plan)", intent: "buy", budget: "From AED 3.1M", viewing_booked: false },
});

const arUnavailable: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "مساء الخير، هل الفيلا في جميرا بارك ما زالت متاحة؟"],
    ["a", "للأسف تم بيع الفيلا الأسبوع الماضي. لكن لدينا فيلا بأربع غرف نوم في المرابع العربية بسعر 4.2 مليون درهم، وحديقة أكبر."],
    ["c", "المرابع العربية بعيدة قليلًا عن عملي. هل لديكم شيء آخر قريب من جميرا؟"],
    ["a", "سأطلب من الوكيل المختص أن يرسل لك الخيارات المتاحة قرب جميرا هذا الأسبوع."],
    ["c", "حسنًا، شكرًا."],
  ],
  outcome: "completed",
  endReason: "caller_hangup",
  sentiment: "neutral",
  summary: "The Jumeirah Park villa the caller asked about is sold. Suggested a 4-bedroom villa in Arabian Ranches (AED 4.2M); the agent will send options closer to Jumeirah.",
  extracted: { property: "Jumeirah Park villa (sold)", intent: "buy", viewing_booked: false },
});

const arTransfer: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "أنا مهتم بشقة مارينا هايتس، لكن السعر مرتفع. هل يقبل المالك 2.2 مليون؟"],
    ["a", "لا أستطيع التفاوض على السعر، لكن يمكنني تحويلك إلى الوكيل المسؤول عن هذا العقار الآن. هل توافق؟"],
    ["c", "نعم، من فضلك."],
    ["t", transfer(c, "Price negotiation, Marina Heights 2BR", "the listing agent")],
    ["a", "جارٍ تحويل المكالمة، لحظة من فضلك."],
  ],
  outcome: "transferred",
  endReason: "transferred",
  sentiment: "neutral",
  summary: "Caller wanted to offer AED 2.2M for the Marina Heights 2-bedroom (listed at 2.4M). Transferred to the listing agent for the negotiation.",
  extracted: { property: "Marina Heights, 2-bedroom (AED 2.4M)", intent: "buy", budget: "AED 2.2M offer", viewing_booked: false },
});

export const PROPERTY_AR: Array<[Scenario, number]> = [
  [arViewing, 9],
  [arRent, 8],
  [arOffPlan, 5],
  [arUnavailable, 3],
  [arTransfer, 3],
];

const lqHot: Scenario = (c) => {
  const { r, person: p } = c;
  const b = booking(c, "en", { tool: c.tools.book!, minDays: 1, maxDays: 5, part: "any", name: p.name, notes: "Consultation: Marina Heights investment", step: 1 });
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Yes, sure, go ahead."],
      ["a", "Thanks! Are you looking to buy a home for yourself, or as an investment?"],
      ["c", "As an investment. I'd rent it out."],
      ["a", "Got it. What budget range are you working with, and when are you hoping to buy?"],
      ["c", pick(r, ["Around two to three million dirhams, ideally within the next two months.", "About two and a half million, and I'd like to close before the end of the year."])],
      ["a", "That fits several units in Marina Heights, including two-bedrooms with a marina view. Would you like a call with one of our property consultants to go through them and the rental yields?"],
      ["c", "Yes, that would be helpful."],
      ["p", 2],
      ["t", b.avail],
      ["a", `I have ${list(b.options.map((o) => o.text), "or")} on ${b.dayText}, Dubai time.`],
      ["c", `${b.chosen.text} works.`],
      ["t", b.book],
      ["a", `Done. A consultant will call you on ${b.dayText} at ${b.chosen.text}, and we'll email you the floor plans before then. Thanks, ${p.first}!`],
      ["c", "Great, thank you."],
    ],
    outcome: "booked",
    endReason: "agent_hangup",
    sentiment: "positive",
    summary: `Investor lead ${p.name}: budget AED 2-3M, buying within two months to rent out. Consultation booked for ${b.dayText} at ${b.chosen.text}.`,
    extracted: { interest_level: "hot", budget: "AED 2-3M", timeline: "Within 2 months", meeting_booked: true },
  };
};

const lqWarm: Scenario = (c) => {
  const { r, person: p } = c;
  const budget = pick(r, ["1.8 million", "2 million", "1.5 million"]);
  return {
    steps: [
      ["a", c.greeting],
      ["c", "Yes, I have a minute."],
      ["a", "Thanks! Are you looking to buy for yourself or as an investment, and what timeline do you have in mind?"],
      ["c", "For myself, but I'm still comparing a few areas. Maybe in six months or so."],
      ["a", "That makes sense. Do you have a budget range in mind?"],
      ["c", `Around ${budget} dirhams.`],
      ["a", "Would it help if we email you the floor plans and price list, and check in with you next month?"],
      ["c", "Yes, email is better for now."],
      ["a", `Perfect. You'll get the details by email today, ${p.first}. Thanks for your time!`],
    ],
    outcome: "qualified",
    endReason: "agent_hangup",
    sentiment: "positive",
    summary: `Warm lead ${p.name}: buying a home in about six months, budget around AED ${budget}. Floor plans sent by email; check in next month.`,
    extracted: { interest_level: "warm", budget: `AED ${budget}`, timeline: "About 6 months", meeting_booked: false, callback_time: "Next month" },
  };
};

const lqNotInterested: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "Ah, thanks, but we already bought a place in JVC last month."],
    ["a", "Congratulations! Thanks for letting us know. I'll close your request so we don't contact you about it again. Have a great day!"],
    ["c", "Thanks, you too."],
  ],
  outcome: "not_interested",
  endReason: "agent_hangup",
  sentiment: "positive",
  summary: `${c.person.name} already bought in JVC last month. Request closed.`,
  extracted: { interest_level: "not_interested", meeting_booked: false },
});

const lqCallback: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "I'm driving right now. Can you call me tomorrow afternoon?"],
    ["a", "Of course, I'll note tomorrow afternoon. Drive safely!"],
  ],
  outcome: "callback",
  endReason: "agent_hangup",
  sentiment: "neutral",
  summary: `${c.person.name} was driving and asked for a call tomorrow afternoon.`,
  extracted: { interest_level: "warm", meeting_booked: false, callback_time: "Tomorrow afternoon" },
});

export const LEAD: Array<[Scenario, number]> = [
  [lqHot, 30],
  [lqWarm, 30],
  [lqNotInterested, 22],
  [lqCallback, 18],
];

// ── Sharma Electronics (Hindi order line) ──

const hiStatus: Scenario = (c) => {
  const { r } = c;
  const order = `SE-${40_000 + Math.floor(r() * 9_999)}`;
  return {
    steps: [
      ["a", c.greeting],
      ["c", `हाँ, मेरा ऑर्डर नंबर ${order} है।`],
      ["t", { name: c.tools.lookup!, args: { order_number: order }, result: { message: `Order ${order}: shipped yesterday with Delhivery, expected delivery Thursday.`, status: "shipped", carrier: "Delhivery" } }],
      ["a", `धन्यवाद। आपका ऑर्डर ${order} कल Delhivery से भेज दिया गया है और गुरुवार तक पहुँच जाएगा। ट्रैकिंग लिंक आपको SMS पर भेज दिया गया है।`],
      ["c", "बढ़िया। क्या डिलीवरी के समय मुझे कॉल आएगी?"],
      ["a", "जी हाँ, डिलीवरी पार्टनर पहुँचने से पहले आपको कॉल करेगा।"],
      ["c", "ठीक है, धन्यवाद।"],
      ["a", "आपका दिन शुभ हो!"],
    ],
    outcome: "completed",
    endReason: "caller_hangup",
    sentiment: "positive",
    summary: `Caller checked order ${order}: shipped yesterday with Delhivery, delivery expected Thursday. Tracking link sent by SMS.`,
    extracted: { order_number: order, order_found: true, request_type: "status" },
  };
};

const hiReturn: Scenario = (c) => {
  const { r } = c;
  const order = `SE-${40_000 + Math.floor(r() * 9_999)}`;
  return {
    steps: [
      ["a", c.greeting],
      ["c", `मुझे हेडफ़ोन वापस करने हैं, आवाज़ ठीक नहीं आ रही। ऑर्डर नंबर ${order} है।`],
      ["t", { name: c.tools.lookup!, args: { order_number: order }, result: { message: `Order ${order}: delivered 3 days ago, eligible for return until next week.`, status: "delivered", returnable: true } }],
      ["a", "समझ गया। आपका ऑर्डर तीन दिन पहले डिलीवर हुआ था, इसलिए यह सात दिन की रिटर्न पॉलिसी में आता है। मैं रिटर्न पिकअप का अनुरोध दर्ज कर रहा हूँ।"],
      ["c", "पैसे कब तक वापस आएँगे?"],
      ["a", "पिकअप के बाद पाँच से सात कामकाजी दिनों में रिफ़ंड आपके मूल भुगतान माध्यम में आ जाएगा।"],
      ["c", "ठीक है, धन्यवाद।"],
    ],
    outcome: "completed",
    endReason: "caller_hangup",
    sentiment: "neutral",
    summary: `Return request for headphones (order ${order}, sound problem). Within the 7-day policy; pickup requested, refund 5-7 working days after pickup.`,
    extracted: { order_number: order, order_found: true, request_type: "return" },
  };
};

const hiDamaged: Scenario = (c) => {
  const { r } = c;
  const order = `SE-${40_000 + Math.floor(r() * 9_999)}`;
  return {
    steps: [
      ["a", c.greeting],
      ["c", `मेरा टीवी आज आया है और उसकी स्क्रीन टूटी हुई है। ऑर्डर ${order} है।`],
      ["a", "यह सुनकर बहुत अफ़सोस हुआ। टूटे हुए सामान के लिए हमारी सपोर्ट टीम तुरंत बदलने की व्यवस्था करती है। मैं आपको अभी उनसे जोड़ रहा हूँ।"],
      ["c", "ठीक है।"],
      ["t", transfer(c, `Damaged TV on delivery, order ${order}`, "the support team")],
      ["a", "कृपया लाइन पर बने रहें।"],
    ],
    outcome: "transferred",
    endReason: "transferred",
    sentiment: "negative",
    summary: `TV from order ${order} arrived with a broken screen. Transferred to the support team for a replacement.`,
    extracted: { order_number: order, order_found: true, request_type: "damaged" },
  };
};

export const ORDERS_HI: Array<[Scenario, number]> = [
  [hiStatus, 6],
  [hiReturn, 3],
  [hiDamaged, 2],
];

// ── Pinecrest Plumbing (Chicago, after-hours line) ──

const ppEmergency: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "Yes, it's an emergency. A pipe burst under my kitchen sink and there's water everywhere."],
    ["a", "I'm sorry, let's stop the water first. Can you find the shutoff valve under the sink, or the main shutoff near your water meter?"],
    ["c", "Okay, I turned the one under the sink. It stopped."],
    ["a", "Well done. I'm connecting you with our on-call plumber now so they can schedule a visit tonight."],
    ["t", transfer(c, "Burst pipe under the kitchen sink, water shut off", "the on-call plumber")],
    ["a", "Transferring you now, please hold."],
  ],
  outcome: "transferred",
  endReason: "transferred",
  sentiment: "neutral",
  summary: "Burst pipe under a kitchen sink. Walked the caller through closing the shutoff valve, then transferred to the on-call plumber.",
  extracted: { caller_name: c.person.name, reason: "Emergency: burst pipe under the kitchen sink", callback_requested: false },
});

const ppWaterHeater: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "Not an emergency, but my water heater stopped working. No hot water since this morning."],
    ["a", "Sorry to hear that. Is there any water leaking around the tank?"],
    ["c", "No, it's dry. It's just not heating."],
    ["a", "Thanks. I'll book you in for our first service call tomorrow morning. Can I have your name and address?"],
    ["c", `${c.person.name}, 2214 North Kedzie Avenue.`],
    ["a", `Got it, ${c.person.first}. A technician will call you between 7:30 and 8 tomorrow to confirm the arrival time.`],
    ["c", "Perfect, thanks."],
  ],
  outcome: "message_taken",
  endReason: "caller_hangup",
  sentiment: "positive",
  summary: `${c.person.name}: water heater not heating (no leak). First service call tomorrow morning; technician to call 7:30-8 AM.`,
  extracted: { caller_name: c.person.name, reason: "Water heater not heating", callback_requested: true, message: "Water heater not heating, no leak. 2214 N Kedzie Ave. First call tomorrow." },
});

const ppQuote: Scenario = (c) => ({
  steps: [
    ["a", c.greeting],
    ["c", "Hi, I'd like a quote for replacing the fixtures in two bathrooms."],
    ["a", "Happy to help. Our estimator can come by for a free quote. What's the best time to reach you tomorrow?"],
    ["c", "Anytime after ten."],
    ["a", `Great. Can I have your name?`],
    ["c", `${c.person.name}.`],
    ["a", `Thanks, ${c.person.first}. Our estimator will call you tomorrow after ten to set up the visit.`],
  ],
  outcome: "message_taken",
  endReason: "agent_hangup",
  sentiment: "positive",
  summary: `${c.person.name} wants a quote for new fixtures in two bathrooms. Estimator to call back tomorrow after 10 AM.`,
  extracted: { caller_name: c.person.name, reason: "Quote: bathroom fixtures", callback_requested: true, message: "Quote for fixtures in two bathrooms; call after 10 AM." },
});

export const PLUMBING: Array<[Scenario, number]> = [
  [ppEmergency, 4],
  [ppWaterHeater, 5],
  [ppQuote, 4],
];

export function pickScenario(r: () => number, bank: ReadonlyArray<[Scenario, number]>): Scenario {
  const total = bank.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [s, w] of bank) {
    x -= w;
    if (x < 0) return s;
  }
  return bank[bank.length - 1][0];
}
