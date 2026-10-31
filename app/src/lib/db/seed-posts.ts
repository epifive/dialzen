/**
 * Starter blog posts created on install (Admin → Blog). Markdown.
 * Written without the product name, so they fit any brand ({site_name}, {site_email} and {year} would be replaced).
 * Listed oldest first: the last post is the newest on the blog.
 */
export const DEFAULT_POSTS = [
  {
    slug: "consent-dnc-calling-hours-checklist-ai-calls",
    title: "Consent, DNC and calling hours: a practical checklist for AI calls (not legal advice)",
    excerpt: "Before an AI agent calls anyone, check consent, do-not-call lists, calling hours, disclosures and opt-outs. Here is a practical checklist for the US, the EU, the UK and India.",
    metaDescription: "A practical checklist for outbound AI phone calls: consent by call purpose, do-not-call lists, calling hours, AI and recording disclosure, opt-outs and audit logs in the US, EU, UK and India. Not legal advice.",
    content: `**This checklist is general information, not legal advice.** Rules differ by country and state, they change, and the details of your calls matter. Before you start outbound calls, talk to a lawyer who knows the rules where you and your contacts are.

## Why AI calls need extra care

Outbound AI calls work well for appointment reminders, confirmations, delivery updates and callbacks that people asked for. They are a poor fit for cold calling. Unwanted calls are one of the most common consumer complaints, regulators treat automated calls strictly, and in the US damages can be counted **per call**.

In February 2024 the US Federal Communications Commission (FCC) confirmed that **AI-generated voices count as an "artificial or prerecorded voice"** under the Telephone Consumer Protection Act (TCPA). In practice, an AI agent calling a person is treated like a prerecorded message, and the same consent rules apply.

## 1. Give every campaign one purpose

The purpose of a call decides the consent you need, so decide it before you upload a single number:

- **Informational calls**: appointment reminders, confirmations, delivery or order updates, a callback the person asked for. In the US these generally need the person's **prior express consent**, typically given when they provided their number for that purpose.
- **Telemarketing calls**: anything that encourages a purchase. In the US these need **prior express written consent**: a signed agreement (electronic is fine) that names the phone number and the seller and makes clear that agreeing is not a condition of purchase.

A reminder that turns into a sales pitch becomes a telemarketing call. Keep each campaign, and each agent's instructions, to one clear purpose.

**Checklist:**

- The campaign's purpose is written down: informational or marketing.
- The agent's prompt sticks to that purpose.

## 2. Keep a consent record for every contact

"They're our customers" is not a consent record. For each contact, store:

- the **type** of consent (express, written, or consent to automated calls in the UK and EU);
- its **purpose** (which kinds of calls it covers);
- **where and when** it was given: the form or page, the date and time, and the IP address for web forms;
- the **exact wording** the person agreed to.

**Checklist:**

- Contacts are imported only with a consent record that fits the campaign's purpose.
- Contacts without suitable consent are skipped automatically at dial time, not by memory.
- Consent records are kept for as long as you may need to prove them.

## 3. Scrub against do-not-call lists, twice

- **United States:** each seller needs its own access to the National Do Not Call Registry, and the copy used must be no more than **31 days** old. Several states have their own lists.
- **Your internal do-not-call list:** everyone who asked you not to call. In the US, requests must be honoured within a reasonable time, at most **10 business days**, and kept for **five years**.
- **United Kingdom:** live marketing calls must be screened against the **Telephone Preference Service** (TPS).

Check the lists when you build a campaign **and again right before each call**: someone may have opted out an hour ago.

**Checklist:**

- National and internal lists are checked before the campaign and at dial time.
- Opt-outs from every channel (calls, email, forms, support) end up on the internal list.

## 4. Call only within the allowed hours, in the contact's time zone

US federal rules allow telephone solicitations only **between 8 am and 9 pm in the called person's local time**. Several states are stricter. Florida and Oklahoma, for example, allow 8 am to 8 pm and limit calls on the same subject to three in 24 hours, Texas starts at 9 am (noon on Sundays), and some states ban these calls on Sundays or public holidays.

Use the **contact's** time zone, not yours, and keep a holiday calendar. When the time zone is unknown, be conservative: use the latest start and the earliest end of the possible zones.

**Checklist:**

- Each contact has a time zone (from the address or the area code).
- Calling windows, state rules and holidays are enforced by software, not by hand.
- Retries are capped per day and per month.

## 5. Say who is calling, that it's an AI, and whether you record

Put these in the **first sentences** of every call:

- **The name of the business** responsible for the call. US rules also require a **callback number** during or after the message.
- **That the caller is speaking with an AI.** In the EU, Article 50 of the AI Act requires people to be told they are interacting with an AI system, at the latest at the first interaction (it applies from 2 August 2026). Several US states, such as Utah and California, have their own AI or bot disclosure rules. And it is simply honest.
- **A recording notice** if you record. Several US states, including California, Florida, Illinois, Maryland, Massachusetts, Pennsylvania and Washington, require the consent of **everyone on the call**, and calls often cross state lines.

Tell the agent never to claim to be human, and to say so honestly when asked.

**Checklist:**

- The first message names the business and says it's an AI assistant.
- Agents that record play a recording notice.
- A callback number is configured.

## 6. Make opting out easy, and honour it immediately

People can **revoke consent by any reasonable means**: saying "stop calling me" during a call, replying to a message, emailing you. For US telemarketing calls with an artificial voice, you must also offer an **automated opt-out** (by voice or key press) within two seconds of identifying the business.

A good AI agent recognises an opt-out request, confirms it politely, ends the call and records it, and the number is skipped from then on.

**Checklist:**

- The agent's instructions cover opt-out requests explicitly.
- Opt-outs said during a call are detected and added to the do-not-call list automatically.
- Opt-outs are kept even when the contact or the campaign is deleted.

## 7. Watch delays and abandoned calls

In the US, a telemarketing call counts as **abandoned** when the person answers and no message starts within **two seconds** of their greeting, and abandoned calls must stay under **3%** of answered calls per campaign over 30 days. Slow AI responses and long answering-machine detection can count. Keep the first message short, keep latency low and pause a campaign when the rate climbs.

**Checklist:**

- The abandonment rate is measured per campaign.
- Campaigns pause automatically above a threshold you set.

## 8. Know the rules outside the US

- **European Union:** under the GDPR you need a legal basis for processing contacts' data, and people have an absolute right to object to direct marketing. Under the ePrivacy rules, **automated calling systems** used for direct marketing need **prior consent**; treat an AI agent as such a system. Rules for live marketing calls differ by country.
- **United Kingdom:** under PECR, automated marketing calls need the person's **specific consent to automated calls**, and the call must give your name and an address or freephone number. The Data (Use and Access) Act 2025 raises the maximum PECR fines to UK GDPR levels.
- **India:** TRAI's rules on commercial communications require registration on the **DLT** platform (entity, headers, templates and consent). Promotional calls must come from the **140 series** and service or transactional calls from the **1600 series**, not from ordinary 10-digit numbers.

## 9. Keep an audit trail

If a complaint arrives, you need to show what happened: which consent the contact had, which lists were checked, when the call was placed in the contact's local time, what the agent said at the start, and whether the person opted out.

**Checklist:**

- Consent checks, do-not-call checks, blocks, dial times, disclosures and opt-outs are logged.
- The log can't be edited after the fact, and can be exported.
- A person reviews a sample of transcripts every week.

## The short version

1. One purpose per campaign, and consent that fits it.
2. Scrub against do-not-call lists before the campaign and again at dial time.
3. Call within the allowed hours of each contact's time zone, with sensible retry limits.
4. Start every call with the business name, the AI disclosure and, if you record, the recording notice.
5. Make opting out easy and honour it at once.
6. Keep the agent fast, and pause campaigns that abandon too many calls.
7. Log everything, and get legal advice before you start and whenever the rules change.

Software can enforce most of this for you: consent fields, do-not-call scrubbing, calling-hour rules and audit logs help a lot. But they are tools. The responsibility for each call stays with the business that makes it.`,
  },
  {
    slug: "inbound-vs-outbound-ai-calls",
    title: "Inbound vs outbound AI calls: where voice agents pay off",
    excerpt: "AI voice agents are not equally useful everywhere. Here is where they earn their keep on inbound calls, where outbound calls make sense, where to keep people on the phone, and how to estimate the cost.",
    metaDescription: "Where AI phone agents pay off: answering inbound calls after hours and at peak times, booking appointments, consented reminders and callbacks, and where humans should stay in charge. With a simple cost estimate.",
    content: `AI voice agents can now hold a natural conversation, look things up and book appointments while the caller is on the line. That doesn't mean every call should go to one. The best results come from picking the right calls, and the split between **inbound** (people calling you) and **outbound** (you calling them) is the first decision.

## Inbound: start here

Inbound calls are the easiest place to start, for a simple reason: the caller chose to call you. They want something now, and the alternative to an AI agent is often **nobody answering at all**.

### Where inbound agents pay off

- **After hours, weekends and holidays.** Calls that would reach voicemail get an answer, a booking or a proper message with a name, number and reason.
- **Peak times and overflow.** When the front desk is busy or two people call at once, the agent takes the second call instead of a queue.
- **Repetitive questions.** Opening hours, location and parking, prices, services, policies, "do you take my insurance?". Answers that come straight from a knowledge base.
- **Booking, moving and cancelling.** With access to the calendar, the agent offers real free slots and books them during the call.
- **Simple lookups.** Order status or a booking reference, through a webhook to your own system.
- **Triage.** Collecting the details first, then transferring to the right person, who starts the conversation already informed.

### What to measure

- **Answer rate**: the share of calls answered, compared with before.
- **Outcomes**: bookings made, questions answered, messages taken, calls transferred.
- **Transfer rate**: too high means the agent lacks information; too low can mean it holds on to calls it should pass on.
- **Caller sentiment** and a weekly read of short calls, transferred calls and negative calls.

## Outbound: only with consent

Outbound calls can be valuable too, but the rules are much stricter. Regulators treat automated calls with suspicion, and in the US an AI voice counts as an artificial voice under the TCPA. Outbound AI calls should go **only to people who agreed to them**, for the purpose they agreed to, inside the allowed calling hours.

### Where outbound agents pay off

- **Appointment reminders and confirmations.** A short call the day before, with the option to confirm or reschedule on the spot, can reduce no-shows, and the result lands in your calendar and call log.
- **Callbacks people asked for.** Someone fills in a form asking to be called. Calling back quickly, while they are still interested, is where a voice agent shines: it can call within minutes, ask the qualifying questions and book a meeting with a person.
- **Service updates.** Delivery windows, order problems, a change to an appointment.
- **Short feedback surveys** for recent customers who agreed to be contacted.

### Where outbound doesn't pay off

- **Cold calling** people who never asked to hear from you. It is risky legally, it damages your brand, and carriers may label your numbers as spam.
- **Long, high-stakes sales conversations**, where trust and judgement matter more than speed.

Every outbound call should start with the business name and the AI disclosure, offer an easy way to opt out, and be checked against consent records and do-not-call lists right before dialing.

## Where people should stay in charge

Whatever the direction, keep a person on the calls that need judgement, empathy or authority: complaints, refunds and disputes, medical, legal or financial questions, emergencies, and upset callers. The agent's job on these calls is to recognise them early and hand them over, with the details already collected.

## A simple cost estimate

Voice agents are usually billed **per minute**. To estimate the cost of a use case, multiply three numbers:

> calls per month × average minutes per call × price per minute

For example, 600 inbound calls a month averaging 2.5 minutes at $0.15 a minute come to 600 × 2.5 × 0.15 = **$225 a month**, plus the phone number. These numbers are only an illustration: use your own call volumes and the price your platform charges.

Then compare that with what the calls are worth: the bookings made after hours, the leads called back within minutes instead of the next day, the no-shows avoided, and the hours your team gets back for the conversations that need them.

## A practical rollout

1. **Start with inbound after hours.** Low risk, easy to measure, and callers are better served than by voicemail.
2. **Add overflow during the day** once the transcripts look good.
3. **Add bookings** by connecting the calendar.
4. **Then add consented outbound**: reminders and requested callbacks first, with consent records, calling hours and opt-outs in place.
5. **Review calls every week** and improve the prompt, the knowledge base and the tools one change at a time.

Picked well, AI calls don't replace your team. They take the routine and the out-of-hours calls, so the people on your team spend their time where it matters most.`,
  },
  {
    slug: "ai-phone-receptionist-prompt",
    title: "How to write a prompt for an AI phone receptionist",
    excerpt: "A prompt that works in a chat window often fails on the phone. Here is how to write instructions for an AI receptionist, give it the right knowledge and tools, and test it before callers do.",
    metaDescription: "How to write a voice agent prompt for an AI phone receptionist: role and goal, an honest first message, short turns, confirming details, tools, hand-off to a person, post-call fields and a testing routine.",
    content: `## Voice is not chat

On a phone call there is no screen. The caller can't scroll back, can't see a list and won't wait through a long paragraph. They interrupt, mumble, change their mind and talk over background noise. An AI receptionist's instructions have to be written for that.

This guide walks through the parts of a good receptionist prompt, the knowledge and tools behind it, and a simple way to test it.

## 1. Decide what the receptionist handles

List why people call you: look at a week of calls or ask whoever answers the phone. A few reasons usually cover most calls. Good jobs for an AI receptionist:

- **Questions with clear answers**: opening hours, location and parking, prices, services, what to bring, the cancellation policy.
- **Booking, moving and cancelling appointments**, when it can check your calendar.
- **Taking a message** with a name, number and reason, so your team can call back prepared.
- **Routing**: finding out what the caller needs and transferring them to the right person.

Keep for people the calls that need judgement, empathy or authority: complaints, refunds, complex quotes, anything medical, legal or financial, and upset callers. The receptionist's job on these calls is to recognise them early and hand them over.

## 2. Start with the role and the goal

Tell the agent who it is, who it works for and what a successful call looks like:

> You are the friendly front-desk receptionist of Green Street Dental, a family dental practice in Springfield. Your goal is to answer questions about the practice and book, move or cancel appointments. If you can't help, take a message for the team.

One clear goal per agent works better than a long list. If you need very different jobs, such as support and sales, use separate agents.

## 3. Write an honest first message

The first few seconds set the tone. A good first message:

1. **Says the business name**, so callers know they reached the right place.
2. **Says it is an AI assistant.** Callers should never be surprised later, and in many places it is required: in the EU, the AI Act requires people to be told they are interacting with an AI at the latest at the first interaction.
3. **Mentions recording, if you record.** Several US states and many countries require the consent of everyone on the call.
4. **Invites the caller to speak.**

For example: "Hi, you've reached Green Street Dental. I'm the practice's AI assistant, and this call is recorded. I can answer questions or book an appointment. How can I help?"

Keep it short: every second before the caller can talk feels long on the phone. And add to the prompt: "If anyone asks whether you are a person or a robot, say honestly that you are an AI assistant."

## 4. Define the tone

Describe how the agent should sound in a few words: "friendly, calm and efficient; warm but not chatty". Add the language it speaks and what to do when a caller uses another one. Choose a voice that fits the business, and listen to it on a real phone line, not only in the browser.

## 5. Keep turns short

This is the most important rule for voice. Put it in the prompt in plain words:

- **One or two sentences per turn**, then let the caller speak.
- **One question at a time.** "What's your name?" then "And the best number to reach you?", never both at once.
- **No lists longer than three items.** Offer two or three options, or ask what the caller prefers.
- **No formatting.** Bullet points, links and symbols mean nothing when spoken. Write numbers, times and dates the way they should be said.

## 6. Confirm the details that matter

Speech recognition makes mistakes, especially with names, numbers and email addresses. Tell the agent to:

- repeat phone numbers back in small groups of digits;
- spell unusual names and email addresses back;
- confirm the date, time and service before booking: "So that's a cleaning on Tuesday the 14th at 10 in the morning. Shall I book it?"

A ten-second confirmation is much cheaper than a missed appointment.

## 7. Give it facts, not marketing

The agent can only be as accurate as the information you give it. Build a knowledge base from your service, pricing and FAQ pages, a plain document with the facts staff repeat every day, and your policies in simple sentences.

- **Write facts.** "We are open Monday to Friday, 8:00 to 18:00, and Saturday 9:00 to 13:00" beats "We're here when you need us".
- **Include what you don't do.** If you don't treat children or don't open on Sundays, say so, or the agent may guess.
- **Keep it current.** When prices or hours change, update the knowledge base the same day.
- **Say what to do when the answer isn't there:** offer to take a message, never invent an answer.

## 8. Describe the tools and when to use them

Tools let the receptionist act: check availability, book an appointment, add a row to a spreadsheet, transfer the call, end the call. For each tool, tell the agent:

- **When to use it**: "Check availability before offering times. Never invent times."
- **What to collect first**: "Before booking, you need the caller's full name, phone number and the service."
- **What to say while it works**: "Say 'One moment while I check the calendar' first." Silence on a call feels broken.
- **What to do if it fails**: "If the booking fails, apologise and offer to take a message."

## 9. Plan the hand-off and the fallbacks

A transfer to a person is not a failure; it is part of the design. Write down what to do when:

- **the caller asks for a person**: transfer during opening hours, take a message otherwise, and say what is happening ("I'll put you through to our front desk now") instead of going silent;
- **the agent doesn't know the answer**: say so and offer a message or a transfer;
- **the caller is upset**: acknowledge it briefly and offer a person;
- **the caller asks not to be called again**: confirm it and end the call politely;
- **the topic is off-limits**: "Don't give medical advice. For emergencies, tell the caller to hang up and call the emergency number.";
- **the line is silent or noisy**: ask once if they are still there, then end the call politely.

## 10. Decide what to collect after each call

Post-call analysis turns a conversation into data. Pick a few fields, for example:

- reason for the call (booking, question, complaint, other);
- appointment booked (yes or no) and its date;
- callback requested, with the best time;
- caller asked not to be called again (yes or no).

Give each field a clear name and a short description. Fixed choices are easier to count than free text.

## Test before callers do

1. **Write ten to twenty scenarios**: the common reasons people call, a booking from start to finish with a change of mind, a question the knowledge base doesn't answer, a request for a person, "are you a robot?", an opt-out, a caller who interrupts or corrects a wrong number.
2. **Make test calls**, first in the browser, then on a real phone. Ask someone who didn't write the prompt to call too.
3. **Read the transcripts.** Did the agent give the business name and the AI disclosure? Were turns short? Did it confirm details, use the tools at the right moment and hand off when it should? Are the post-call fields right?
4. **Change one thing at a time** and repeat the scenarios that failed.

Then go live gradually: after hours first, then for overflow when the team is busy, then for all calls once you trust it.

## Keep improving

An AI receptionist is never finished. Every week, read the short calls, the transferred calls and the calls with negative sentiment, pick the most common problem and fix it: add a missing fact, clarify an instruction, add a tool. After a month or two, most routine calls run smoothly, and your team spends its time on the conversations that really need a person.`,
  },
];
