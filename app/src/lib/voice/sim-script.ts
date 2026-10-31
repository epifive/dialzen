import type { AgentSpec, AnalysisField, CallStatus, EndReason, Sentiment, TranscriptTurn } from "@/voice/types";

/**
 * Scenario scripts of the Simulated provider: realistic dialogues per agent kind in English,
 * Hindi and Arabic, the analysis fields filled from the outcome, sentiment, cost and latency.
 * Deterministic for a seed (the provider call id), so tests and screenshots are stable. Pure.
 */

export type SimLang = "en" | "hi" | "ar";
export type SimFamily = "reception" | "booking" | "lead" | "support" | "order" | "reminder" | "survey" | "realestate";
/** "silent": answered, but the agent only speaks after 4 seconds (tests the abandoned-call guard; never drawn at random). */
export type SimOutcome = "completed" | "booked" | "opt_out" | "no_answer" | "busy" | "voicemail" | "failed" | "transferred" | "silent";

export const SIM_OUTCOMES: readonly SimOutcome[] = ["completed", "booked", "opt_out", "no_answer", "busy", "voicemail", "failed", "transferred", "silent"];

// ── Seeded randomness ──

export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];

// ── Agent kind and language ──

export function simLang(language: string): SimLang {
  const l = language.slice(0, 2).toLowerCase();
  return l === "hi" ? "hi" : l === "ar" ? "ar" : "en";
}

/** The kind of dialogue that fits the agent, from its name, prompt and analysis fields. */
export function simFamily(agent: Pick<AgentSpec, "name" | "systemPrompt" | "settings">): SimFamily {
  const keys = agent.settings.analysisFields.map((f) => f.key).join(" ");
  const hay = `${agent.name} ${keys} ${agent.systemPrompt.slice(0, 600)}`.toLowerCase();
  if (/viewing|property|real estate|listing/.test(hay)) return "realestate";
  if (/nps|survey|feedback/.test(hay)) return "survey";
  if (/remind|confirm(ed|ation)|reschedul/.test(hay)) return "reminder";
  if (/order_number|order status|tracking|order/.test(hay)) return "order";
  if (/interest_level|qualif|lead/.test(hay)) return "lead";
  if (/support|issue|ticket|resolved/.test(hay)) return "support";
  if (/appointment|booking|book /.test(hay)) return "booking";
  return "reception";
}

// ── Dialogue banks ──

type Line = ["agent" | "caller", string];

const PEOPLE: Record<SimLang, Array<{ name: string; first: string; email: string }>> = {
  en: [
    { name: "Sarah Johnson", first: "Sarah", email: "sarah.johnson@example.com" },
    { name: "Michael Chen", first: "Michael", email: "m.chen@example.com" },
    { name: "Emily Davis", first: "Emily", email: "emily.davis@example.com" },
    { name: "David Miller", first: "David", email: "david.miller@example.com" },
  ],
  hi: [
    { name: "प्रिया शर्मा", first: "प्रिया", email: "priya.sharma@example.com" },
    { name: "राहुल वर्मा", first: "राहुल", email: "rahul.verma@example.com" },
    { name: "अंजलि गुप्ता", first: "अंजलि", email: "anjali.gupta@example.com" },
  ],
  ar: [
    { name: "عمر حداد", first: "عمر", email: "omar.haddad@example.com" },
    { name: "ليلى منصور", first: "ليلى", email: "layla.mansour@example.com" },
    { name: "يوسف الأمين", first: "يوسف", email: "yousef.alamin@example.com" },
  ],
};

const DAYS: Record<SimLang, string[]> = {
  en: ["Tuesday at 10:30 AM", "Thursday at 2 PM", "Friday at 11 AM"],
  hi: ["मंगलवार सुबह 10:30 बजे", "गुरुवार दोपहर 2 बजे", "शुक्रवार सुबह 11 बजे"],
  ar: ["يوم الثلاثاء الساعة 10:30 صباحًا", "يوم الخميس الساعة 2 ظهرًا", "يوم الجمعة الساعة 11 صباحًا"],
};

const DIALOGUES: Record<SimFamily, Record<SimLang, Line[]>> = {
  reception: {
    en: [
      ["caller", "Hi, I wanted to ask about your opening hours this weekend."],
      ["agent", "Of course. We're open Saturday from 9 to 5 and closed on Sunday. Is there anything else I can help with?"],
      ["caller", "Could someone call me back about a quote? My name is {name}."],
      ["agent", "Sure, {first}. I've noted that you'd like a callback about a quote. Is this the best number to reach you?"],
      ["caller", "Yes, this number is fine."],
      ["agent", "Great, I've passed your message to the team and someone will call you back today. Thanks for calling!"],
      ["caller", "Thank you, bye."],
    ],
    hi: [
      ["caller", "नमस्ते, मुझे इस वीकेंड का आपका समय जानना था।"],
      ["agent", "ज़रूर। हम शनिवार सुबह 9 से शाम 5 बजे तक खुले हैं और रविवार को बंद रहते हैं।"],
      ["caller", "क्या कोई मुझे कोटेशन के बारे में वापस कॉल कर सकता है? मेरा नाम {name} है।"],
      ["agent", "बिल्कुल, {first} जी। मैंने आपका संदेश टीम को भेज दिया है, आज ही कोई आपको कॉल करेगा।"],
      ["caller", "धन्यवाद।"],
      ["agent", "कॉल करने के लिए धन्यवाद, आपका दिन शुभ हो!"],
    ],
    ar: [
      ["caller", "مرحبًا، أردت أن أسأل عن مواعيد العمل في عطلة نهاية الأسبوع."],
      ["agent", "بالتأكيد. نعمل يوم السبت من التاسعة حتى الخامسة ونغلق يوم الأحد."],
      ["caller", "هل يمكن لأحد أن يتصل بي بخصوص عرض سعر؟ اسمي {name}."],
      ["agent", "بالطبع يا {first}. أرسلت رسالتك إلى الفريق وسيتصل بك أحدهم اليوم."],
      ["caller", "شكرًا لك."],
      ["agent", "شكرًا لاتصالك، يومك سعيد!"],
    ],
  },
  booking: {
    en: [
      ["caller", "Hi, I'd like to book a cleaning appointment."],
      ["agent", "Happy to help. May I have your full name, please?"],
      ["caller", "It's {name}."],
      ["agent", "Thanks, {first}. I have openings on {time} or the following morning. Which works better?"],
      ["caller", "{time} works for me."],
      ["agent", "Done. You're booked for a cleaning on {time}. You'll get a confirmation by text. Anything else?"],
      ["caller", "No, that's all. Thanks!"],
      ["agent", "You're welcome, see you then. Goodbye!"],
    ],
    hi: [
      ["caller", "नमस्ते, मुझे सफ़ाई के लिए अपॉइंटमेंट बुक करनी है।"],
      ["agent", "ज़रूर, मैं मदद करता हूँ। आपका पूरा नाम बताइए?"],
      ["caller", "मेरा नाम {name} है।"],
      ["agent", "धन्यवाद {first} जी। {time} या अगली सुबह जगह है। आपको कौन सा समय ठीक रहेगा?"],
      ["caller", "{time} ठीक है।"],
      ["agent", "हो गया। आपकी अपॉइंटमेंट {time} के लिए बुक है। आपको SMS से पुष्टि मिलेगी।"],
      ["caller", "बहुत धन्यवाद।"],
    ],
    ar: [
      ["caller", "مرحبًا، أريد حجز موعد لتنظيف الأسنان."],
      ["agent", "يسعدني مساعدتك. ما اسمك الكامل من فضلك؟"],
      ["caller", "اسمي {name}."],
      ["agent", "شكرًا يا {first}. لدينا موعد متاح {time} أو صباح اليوم التالي. أيهما يناسبك؟"],
      ["caller", "{time} يناسبني."],
      ["agent", "تم الحجز {time}. ستصلك رسالة تأكيد. هل هناك شيء آخر؟"],
      ["caller", "لا، شكرًا جزيلًا."],
    ],
  },
  lead: {
    en: [
      ["caller", "Yes, I have a few minutes."],
      ["agent", "Great. What made you reach out to us, and what are you hoping to solve?"],
      ["caller", "We need a better way to handle inbound calls for our three clinics."],
      ["agent", "That makes sense. Do you have a rough budget and a timeline in mind?"],
      ["caller", "Around two to three thousand a month, and we'd like to start next month."],
      ["agent", "Thanks, that's helpful. Would you like to meet one of our specialists? I can offer {time}."],
      ["caller", "Sure, {time} is good."],
      ["agent", "Perfect, you're booked with a specialist on {time}. Thanks for your time, {first}!"],
    ],
    hi: [
      ["caller", "हाँ, अभी बात कर सकते हैं।"],
      ["agent", "बढ़िया। आप किस समस्या का समाधान ढूँढ रहे हैं?"],
      ["caller", "हमारे तीन क्लीनिक के कॉल संभालने का बेहतर तरीका चाहिए।"],
      ["agent", "समझ गया। आपका बजट और समय-सीमा क्या है?"],
      ["caller", "लगभग दो लाख महीना, और अगले महीने से शुरू करना है।"],
      ["agent", "धन्यवाद। क्या आप हमारे विशेषज्ञ से {time} मिलना चाहेंगे?"],
      ["caller", "हाँ, ठीक है।"],
    ],
    ar: [
      ["caller", "نعم، لدي بضع دقائق."],
      ["agent", "رائع. ما المشكلة التي تبحث عن حل لها؟"],
      ["caller", "نحتاج طريقة أفضل للرد على المكالمات في عياداتنا الثلاث."],
      ["agent", "مفهوم. ما الميزانية التقريبية والجدول الزمني؟"],
      ["caller", "حوالي عشرة آلاف شهريًا، ونريد البدء الشهر القادم."],
      ["agent", "شكرًا. هل تود مقابلة أحد المختصين {time}؟"],
      ["caller", "نعم، مناسب."],
    ],
  },
  support: {
    en: [
      ["caller", "Hi, I can't log in to my account since this morning."],
      ["agent", "Sorry about that. Could you tell me the email address on the account?"],
      ["caller", "Sure, it's {email}."],
      ["agent", "Thanks. I've sent a password reset link to that address. Could you check your inbox?"],
      ["caller", "Got it... and I'm in now. That worked."],
      ["agent", "Great to hear! Is there anything else I can help you with today?"],
      ["caller", "No, that's everything, thank you."],
    ],
    hi: [
      ["caller", "नमस्ते, सुबह से मैं अपने अकाउंट में लॉग इन नहीं कर पा रहा हूँ।"],
      ["agent", "माफ़ कीजिए। अकाउंट का ईमेल बता सकते हैं?"],
      ["caller", "हाँ, {email}।"],
      ["agent", "धन्यवाद। मैंने पासवर्ड रीसेट लिंक भेज दिया है, कृपया इनबॉक्स देखें।"],
      ["caller", "मिल गया, अब लॉग इन हो गया।"],
      ["agent", "बहुत बढ़िया! और कुछ मदद चाहिए?"],
      ["caller", "नहीं, धन्यवाद।"],
    ],
    ar: [
      ["caller", "مرحبًا، لا أستطيع تسجيل الدخول إلى حسابي منذ الصباح."],
      ["agent", "نأسف لذلك. ما البريد الإلكتروني المرتبط بالحساب؟"],
      ["caller", "إنه {email}."],
      ["agent", "شكرًا. أرسلت رابط إعادة تعيين كلمة المرور، هل يمكنك التحقق من بريدك؟"],
      ["caller", "وصلني، وتمكنت من الدخول الآن."],
      ["agent", "ممتاز! هل هناك شيء آخر أساعدك به؟"],
      ["caller", "لا، شكرًا لك."],
    ],
  },
  order: {
    en: [
      ["caller", "Yes, my order number is {order}."],
      ["agent", "Thanks. I found it: order {order} shipped yesterday and should arrive on {time}."],
      ["caller", "Great. Can I change the delivery address?"],
      ["agent", "Since it has shipped I can't change it here, but I'll ask the team to contact the courier for you."],
      ["caller", "Okay, thanks for checking."],
      ["agent", "You're welcome. Have a great day!"],
    ],
    hi: [
      ["caller", "हाँ, मेरा ऑर्डर नंबर {order} है।"],
      ["agent", "धन्यवाद। ऑर्डर {order} कल भेज दिया गया है और {time} तक पहुँच जाएगा।"],
      ["caller", "बढ़िया, धन्यवाद।"],
      ["agent", "आपका स्वागत है, आपका दिन शुभ हो!"],
    ],
    ar: [
      ["caller", "نعم، رقم طلبي {order}."],
      ["agent", "شكرًا. وجدت الطلب {order}، تم شحنه أمس وسيصل {time}."],
      ["caller", "ممتاز، شكرًا."],
      ["agent", "على الرحب والسعة، يومك سعيد!"],
    ],
  },
  reminder: {
    en: [
      ["caller", "Yes, I can still make it."],
      ["agent", "Wonderful, I've marked your appointment as confirmed. Please arrive ten minutes early."],
      ["caller", "Will do. Thanks for the reminder."],
      ["agent", "You're welcome, {first}. See you then!"],
    ],
    hi: [
      ["caller", "हाँ, मैं आ पाऊँगी।"],
      ["agent", "बहुत अच्छा, मैंने आपकी अपॉइंटमेंट कन्फ़र्म कर दी है। कृपया दस मिनट पहले आएँ।"],
      ["caller", "ठीक है, याद दिलाने के लिए धन्यवाद।"],
    ],
    ar: [
      ["caller", "نعم، سأحضر في الموعد."],
      ["agent", "رائع، تم تأكيد موعدك. يرجى الحضور قبل عشر دقائق."],
      ["caller", "حسنًا، شكرًا على التذكير."],
    ],
  },
  survey: {
    en: [
      ["caller", "Sure, go ahead."],
      ["agent", "On a scale from 0 to 10, how likely are you to recommend us to a friend?"],
      ["caller", "I'd say a nine."],
      ["agent", "Thank you! What did you like most about your visit?"],
      ["caller", "The staff were really friendly and quick."],
      ["agent", "Glad to hear it. Is there anything we could do better?"],
      ["caller", "Parking was a bit hard to find."],
      ["agent", "Thanks, I'll pass that on. Have a lovely day!"],
    ],
    hi: [
      ["caller", "हाँ, पूछिए।"],
      ["agent", "0 से 10 में, आप हमें दोस्तों को कितना सुझाएँगे?"],
      ["caller", "नौ।"],
      ["agent", "धन्यवाद! आपको सबसे अच्छा क्या लगा?"],
      ["caller", "स्टाफ़ बहुत मददगार था।"],
      ["agent", "और हम क्या बेहतर कर सकते हैं?"],
      ["caller", "पार्किंग थोड़ी मुश्किल थी।"],
    ],
    ar: [
      ["caller", "بالتأكيد، تفضل."],
      ["agent", "من 0 إلى 10، ما مدى احتمال أن توصي بنا لصديق؟"],
      ["caller", "تسعة."],
      ["agent", "شكرًا! ما الذي أعجبك أكثر؟"],
      ["caller", "الموظفون كانوا لطفاء جدًا."],
      ["agent", "وما الذي يمكننا تحسينه؟"],
      ["caller", "كان من الصعب إيجاد موقف للسيارة."],
    ],
  },
  realestate: {
    en: [
      ["caller", "I'm calling about the two-bedroom apartment on Maple Street."],
      ["agent", "Great choice. Are you looking to buy or rent?"],
      ["caller", "To buy. My budget is around 450 thousand."],
      ["agent", "That fits this listing. Would you like to book a viewing? I have {time} available."],
      ["caller", "Yes, {time} please. I'm {name}."],
      ["agent", "You're booked for a viewing on {time}, {first}. Our agent will meet you at the property."],
      ["caller", "Perfect, thank you."],
    ],
    hi: [
      ["caller", "मैं मेपल स्ट्रीट वाले दो बेडरूम फ़्लैट के बारे में कॉल कर रहा हूँ।"],
      ["agent", "बढ़िया। आप खरीदना चाहते हैं या किराए पर लेना?"],
      ["caller", "खरीदना। बजट लगभग 80 लाख है।"],
      ["agent", "क्या आप {time} देखने आना चाहेंगे?"],
      ["caller", "हाँ। मेरा नाम {name} है।"],
      ["agent", "{first} जी, आपकी विज़िट {time} बुक हो गई है।"],
    ],
    ar: [
      ["caller", "أتصل بخصوص الشقة ذات غرفتي النوم في شارع القيقب."],
      ["agent", "اختيار رائع. هل تريد الشراء أم الإيجار؟"],
      ["caller", "الشراء، وميزانيتي حوالي مليون ونصف."],
      ["agent", "هل تود حجز معاينة {time}؟"],
      ["caller", "نعم من فضلك، اسمي {name}."],
      ["agent", "تم حجز المعاينة {time} يا {first}."],
    ],
  },
};

const OPT_OUT_LINES: Record<SimLang, Line[]> = {
  en: [
    ["caller", "Please don't call me again."],
    ["agent", "I'm sorry for the trouble. I've removed your number and you won't be called again. Goodbye."],
  ],
  hi: [
    ["caller", "मुझे दोबारा कॉल मत करना।"],
    ["agent", "असुविधा के लिए क्षमा करें। आपका नंबर हटा दिया गया है, आपको दोबारा कॉल नहीं आएगी।"],
  ],
  ar: [
    ["caller", "لا تتصل بي مرة أخرى من فضلك."],
    ["agent", "نعتذر عن الإزعاج. تمت إزالة رقمك ولن نتصل بك مجددًا."],
  ],
};

const TRANSFER_LINES: Record<SimLang, Line[]> = {
  en: [
    ["caller", "Actually, can I speak to a person?"],
    ["agent", "Of course. Let me transfer you to a member of our team now."],
  ],
  hi: [
    ["caller", "क्या मैं किसी व्यक्ति से बात कर सकता हूँ?"],
    ["agent", "ज़रूर, मैं आपको अभी टीम के सदस्य से जोड़ रहा हूँ।"],
  ],
  ar: [
    ["caller", "هل يمكنني التحدث إلى شخص؟"],
    ["agent", "بالطبع، سأحولك الآن إلى أحد أعضاء الفريق."],
  ],
};

const SUMMARIES: Record<SimFamily, Record<"positive" | "opt_out" | "transferred", string>> = {
  reception: { positive: "The caller asked about weekend opening hours and requested a callback about a quote; the message was passed to the team.", opt_out: "The caller asked not to be called again; the number was added to the do-not-call list.", transferred: "The caller asked for a person and was transferred to the team." },
  booking: { positive: "The caller booked a cleaning appointment and will receive a text confirmation.", opt_out: "The caller asked not to be called again; no appointment was booked.", transferred: "The caller wanted to speak to staff and was transferred before booking." },
  lead: { positive: "Qualified lead with a budget and a start next month; a meeting with a specialist was booked.", opt_out: "The lead asked not to be contacted again.", transferred: "The lead asked for a person and was transferred to sales." },
  support: { positive: "The caller couldn't log in; a password reset link solved the problem during the call.", opt_out: "The caller asked not to be called again.", transferred: "The caller's issue needed a person and was escalated by transfer." },
  order: { positive: "The caller checked an order status; it has shipped and arrives soon. Address change passed to the team.", opt_out: "The caller asked not to be called again.", transferred: "The caller was transferred to the orders team." },
  reminder: { positive: "The customer confirmed the upcoming appointment.", opt_out: "The customer asked not to receive reminder calls any more.", transferred: "The customer asked for a person to change the appointment." },
  survey: { positive: "The customer gave a 9/10 score, praised the staff and mentioned parking could be easier.", opt_out: "The customer declined the survey and asked not to be called again.", transferred: "The customer asked to speak with a manager." },
  realestate: { positive: "A buyer asked about the Maple Street apartment, mentioned their budget and booked a viewing.", opt_out: "The caller asked not to be contacted again.", transferred: "The caller was transferred to a listing agent." },
};

// ── Script ──

export interface SimScriptInput {
  agent: Pick<AgentSpec, "name" | "systemPrompt" | "settings" | "language" | "firstMessage">;
  direction: "inbound" | "outbound" | "web";
  /** Provider-style variables ({{business_name}}…). */
  variables: Record<string, string>;
  seed: string;
  /** Forced outcome (tests, demo); otherwise drawn from realistic odds. */
  outcome?: SimOutcome | null;
  /** Start of the call (ms). */
  now: number;
}

export interface SimScript {
  outcome: SimOutcome;
  status: CallStatus;
  endReason: EndReason;
  /** Seconds from start until the call is answered (0 for unanswered calls). */
  answerDelaySec: number;
  turns: TranscriptTurn[];
  durationSec: number;
  costMicros: number;
  latencyMs: number;
  summary: string;
  sentiment: Sentiment;
  extracted: Record<string, unknown>;
  success: boolean | null;
  lang: SimLang;
}

/** Cost per minute the simulated provider "charges" (micros). */
export const SIM_COST_PER_MIN_MICROS = 70_000;

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => values[`var:${k}`] ?? "");
}

function drawOutcome(r: () => number, direction: SimScriptInput["direction"]): SimOutcome {
  const x = r();
  if (direction !== "outbound") return x < 0.08 ? "transferred" : x < 0.11 ? "opt_out" : "completed";
  if (x < 0.62) return "completed";
  if (x < 0.66) return "transferred";
  if (x < 0.7) return "opt_out";
  if (x < 0.82) return "no_answer";
  if (x < 0.88) return "busy";
  if (x < 0.97) return "voicemail";
  return "failed";
}

function fieldValue(f: AnalysisField, ctx: { positive: boolean; person: { name: string; email: string }; time: string; order: string; r: () => number; now: number }): unknown {
  const k = f.key;
  if (f.type === "boolean") {
    if (/cancel|escalat|reschedul/.test(k)) return false;
    return ctx.positive;
  }
  if (f.type === "number") return /score|nps|rating/.test(k) ? (ctx.positive ? 9 : 3) : Math.round(ctx.r() * 100);
  if (f.type === "enum") {
    if (!f.options.length) return null;
    if (!ctx.positive) return f.options.find((o) => /not|cold|other|unknown/.test(o)) ?? f.options[f.options.length - 1];
    return f.options.find((o) => /hot|status|buy|yes/.test(o)) ?? f.options[0];
  }
  if (f.type === "date") {
    if (!ctx.positive) return null;
    const d = new Date(ctx.now + (2 + Math.floor(ctx.r() * 4)) * 86_400_000);
    d.setUTCHours(10 + Math.floor(ctx.r() * 6), 0, 0, 0);
    return d.toISOString();
  }
  if (/name/.test(k)) return ctx.person.name;
  if (/email/.test(k)) return ctx.person.email;
  if (/order/.test(k)) return ctx.order;
  if (/budget/.test(k)) return "2,000-3,000 per month";
  if (/timeline/.test(k)) return "Next month";
  if (/time/.test(k)) return ctx.positive ? ctx.time : "";
  if (/category|issue/.test(k)) return "login";
  if (/reason/.test(k)) return "Opening hours and a quote request";
  if (/property/.test(k)) return "2-bedroom apartment, Maple Street";
  if (/service/.test(k)) return "Cleaning";
  if (/liked/.test(k)) return "Friendly, quick staff";
  if (/improve/.test(k)) return "Easier parking";
  if (/message/.test(k)) return "Please call back about a quote.";
  return ctx.positive ? "Yes" : "";
}

/** The whole simulated call, decided up front. */
export function buildSimScript(input: SimScriptInput): SimScript {
  const r = rng(seedOf(input.seed));
  const lang = simLang(input.agent.language);
  const family = simFamily(input.agent);
  const outcome = input.outcome ?? drawOutcome(r, input.direction);
  const person = pick(r, PEOPLE[lang]);
  const time = pick(r, DAYS[lang]);
  const order = `#${10_000 + Math.floor(r() * 89_999)}`;
  const varValues: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.variables)) varValues[`var:${k}`] = v;
  const values = { name: person.name, first: person.first, email: person.email, time, order, business: input.variables.business_name ?? "", ...varValues };
  const latencyMs = 520 + Math.floor(r() * 430);
  const unanswered = outcome === "no_answer" || outcome === "busy" || outcome === "failed";

  if (unanswered) {
    const status: CallStatus = outcome === "no_answer" ? "no_answer" : outcome === "busy" ? "busy" : "failed";
    return {
      outcome,
      status,
      endReason: outcome === "no_answer" ? "no_answer" : outcome === "busy" ? "busy" : "error",
      answerDelaySec: 0,
      turns: [],
      durationSec: 0,
      costMicros: 0,
      latencyMs,
      summary: "",
      sentiment: "unknown",
      extracted: {},
      success: null,
      lang,
    };
  }

  const turns: TranscriptTurn[] = [];
  let at = outcome === "silent" ? 4 : 1;
  const say = (role: "agent" | "caller", text: string) => {
    turns.push({ role, text: fill(text, values), at });
    at += 3 + Math.floor(r() * 4) + Math.ceil(text.length / 40);
  };

  if (outcome === "voicemail") {
    const msg = input.agent.settings.voicemailAction === "leave_message" && input.agent.settings.voicemailMessage ? input.agent.settings.voicemailMessage : "";
    if (msg) say("agent", fill(msg, values));
    const durationSec = Math.max(6, msg ? at : 4);
    return {
      outcome,
      status: "voicemail",
      endReason: "voicemail",
      answerDelaySec: 6,
      turns,
      durationSec,
      costMicros: Math.ceil((durationSec * SIM_COST_PER_MIN_MICROS) / 60),
      latencyMs,
      summary: msg ? "Reached voicemail; the agent left a message." : "Reached voicemail; the agent hung up.",
      sentiment: "unknown",
      extracted: {},
      success: false,
      lang,
    };
  }

  say("agent", input.agent.firstMessage);
  const dialogue = DIALOGUES[family][lang];
  if (outcome === "opt_out") {
    for (const [role, t] of OPT_OUT_LINES[lang]) say(role, t);
  } else if (outcome === "transferred") {
    for (const [role, t] of dialogue.slice(0, 2)) say(role, t);
    for (const [role, t] of TRANSFER_LINES[lang]) say(role, t);
  } else {
    for (const [role, t] of dialogue) say(role, t);
  }
  const durationSec = at + 2;
  const positive = outcome === "completed" || outcome === "booked";
  const extracted: Record<string, unknown> = {};
  for (const f of input.agent.settings.analysisFields) {
    const v = fieldValue(f, { positive, person, time, order, r, now: input.now });
    if (v !== null && v !== "") extracted[f.key] = v;
  }
  if (outcome === "opt_out") extracted.opted_out = true;
  const summaryKind = outcome === "opt_out" ? "opt_out" : outcome === "transferred" ? "transferred" : "positive";
  return {
    outcome,
    status: "completed",
    endReason: outcome === "opt_out" ? "opt_out" : outcome === "transferred" ? "transferred" : r() < 0.5 ? "caller_hangup" : "agent_hangup",
    answerDelaySec: input.direction === "outbound" ? 4 + Math.floor(r() * 6) : 1,
    turns,
    durationSec,
    costMicros: Math.ceil((durationSec * SIM_COST_PER_MIN_MICROS) / 60),
    latencyMs,
    summary: SUMMARIES[family][summaryKind],
    sentiment: outcome === "opt_out" ? "negative" : outcome === "transferred" ? "neutral" : "positive",
    extracted,
    success: positive,
    lang,
  };
}

// ── Text-mode test chat (no AI configured) ──

const CANNED: Record<SimLang, { fallback: string[]; bye: string; optOut: string; human: string }> = {
  en: {
    fallback: ["Thanks, I've noted that. Is there anything else I can help you with?", "I can help with that. Could you tell me a bit more?", "Got it. Would you like me to book a time for you or take a message for the team?"],
    bye: "Thanks for chatting with me. Goodbye!",
    optOut: "I'm sorry for the trouble. I've noted that you don't want to be called again. Goodbye.",
    human: "Of course. In a real call I would transfer you to a member of the team now.",
  },
  hi: {
    fallback: ["धन्यवाद, मैंने नोट कर लिया है। और कुछ मदद चाहिए?", "ज़रूर, थोड़ा और बताइए?", "ठीक है। क्या मैं आपके लिए समय बुक करूँ या टीम के लिए संदेश लूँ?"],
    bye: "बात करने के लिए धन्यवाद। नमस्ते!",
    optOut: "असुविधा के लिए क्षमा करें। आपको दोबारा कॉल नहीं की जाएगी।",
    human: "ज़रूर। असली कॉल में मैं आपको अभी टीम के सदस्य से जोड़ देता।",
  },
  ar: {
    fallback: ["شكرًا، سجلت ذلك. هل هناك شيء آخر أساعدك به؟", "بالتأكيد، هل يمكنك توضيح المزيد؟", "حسنًا. هل تريد أن أحجز لك موعدًا أو أترك رسالة للفريق؟"],
    bye: "شكرًا لحديثك معي. مع السلامة!",
    optOut: "نعتذر عن الإزعاج. لن نتصل بك مرة أخرى.",
    human: "بالطبع. في المكالمة الحقيقية سأحولك الآن إلى أحد أعضاء الفريق.",
  },
};

/** A scripted reply of the agent in the text-mode test chat (used when no AI provider is configured). */
export function cannedReply(language: string, history: ReadonlyArray<{ role: string; text: string }>, optOut: boolean): { text: string; end: boolean } {
  const lang = simLang(language);
  const c = CANNED[lang];
  const last = [...history].reverse().find((t) => t.role === "caller")?.text.toLowerCase() ?? "";
  if (optOut) return { text: c.optOut, end: true };
  if (/\b(bye|goodbye|that's all|thank you, bye)\b|अलविदा|नमस्ते$|مع السلامة/.test(last)) return { text: c.bye, end: true };
  if (/\b(human|person|agent|someone)\b|इंसान|व्यक्ति|شخص|موظف/.test(last)) return { text: c.human, end: false };
  const turn = history.filter((t) => t.role === "caller").length;
  return { text: c.fallback[(turn - 1 + c.fallback.length) % c.fallback.length], end: false };
}
