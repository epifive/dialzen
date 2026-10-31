/**
 * Default content pages created on install. Buyers edit them from
 * Admin → Pages. `{site_name}` and `{site_email}` are replaced when rendered.
 * They are a starting point, not legal advice: buyers should adapt them to their
 * business and the laws that apply to them.
 */
export const DEFAULT_PAGES = [
  {
    slug: "about",
    title: "About Us",
    metaDescription: "{site_name} lets businesses create AI phone agents for inbound support, appointment booking and consented follow-ups, with AI disclosure, consent records and human hand-off built in.",
    content: `## Who we are

{site_name} is a platform for AI phone agents. Small businesses, clinics, agencies and support teams use it to answer calls around the clock, book appointments and make follow-up and reminder calls to people who agreed to receive them.

## What {site_name} does

- **Inbound support.** An agent answers your number, explains your opening hours, prices and policies from your knowledge base, and takes messages when it can't help.
- **Appointment booking.** Agents check availability and book, move or cancel appointments in Cal.com or Google Calendar while the caller is on the line.
- **Consented follow-ups and reminders.** Run outbound campaigns for appointment reminders, order updates and callbacks to contacts who gave the consent the law requires, within the calling hours of each contact's time zone.
- **Hand-off to a human.** When a caller asks for a person, or the agent reaches the limit of what it should handle, it transfers the call to your team.
- **On your website too.** A "Talk to us" voice button lets visitors speak with an agent in their browser, and every agent can be tested from the dashboard before it takes real calls.
- **In your callers' language.** Agents speak many languages and accents, including Hindi and Arabic.
- **Call logs you can act on.** Every call has a transcript, a summary, the caller's sentiment and the details you asked the agent to collect, plus a recording when recording is turned on.
- **Teams and integrations.** Invite your team with roles, send results to Google Sheets or your own webhooks, get notified by email, Slack, Microsoft Teams, Discord or Telegram, and connect your own systems through the REST API.

## How it works

1. **You build the agent** in your dashboard: its instructions, voice, language, first message, knowledge base and tools.
2. **A managed voice provider runs the call.** The voice provider chosen by the operator of this platform (for example ElevenLabs or Retell AI) handles the live audio: it listens, thinks with the AI model and speaks, with low delay.
3. **Your dashboard is the control centre.** Phone numbers, contacts, consent records, do-not-call lists, campaigns, credits, analytics and call logs all live in {site_name}. When a call ends, its transcript, summary and recording come back here.

## What we believe

- **Callers deserve to know.** Every agent tells callers at the start of the call that they are speaking with an AI assistant, and answers honestly when asked.
- **Consent comes first.** Outbound calls only go to contacts with a consent record that fits the purpose of the campaign, and never to numbers on a do-not-call list. Outbound calling is enabled only after we review and approve the workspace.
- **A human is always one step away.** Agents should hand off to a person whenever the caller wants one or the situation needs one.
- **Your data is yours.** Export calls and contacts as CSV, or read everything through the REST API, whenever you like.

## Contact

Questions or ideas? [Get in touch](/contact). We read every message.`,
  },
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    metaDescription: "How {site_name} handles account data, AI agents, contacts and consent records, call recordings and transcripts, and the providers that help run the calls.",
    content: `## Overview

This policy explains what data {site_name} collects, why, who processes it on our behalf and what control you have over it. It covers two groups of people: our **customers** (the businesses that use {site_name} and their team members) and the **people our customers call or who call them**. We collect only what is needed to run the service.

## Our role and our customers' role

For your account, your workspace and how you use {site_name}, we decide how the data is used, so we are the **controller**.

For the contacts, call recordings, transcripts and other data about the people a business calls or is called by, **the business (our customer) is the controller** and decides why and how those people are contacted. We act as a **processor** on its behalf: we store and process that data only to provide the service the business asked for, following its settings and instructions. If you were called by a business through {site_name}, the business's own privacy notice applies to you, and you should contact the business first. The section "If you received a call" below explains how to reach us too.

## Account data

When you create an account we store your name, email address and a securely hashed password, your language preference and your plan. Payments are handled by our payment providers; we receive the payment status and a reference, never your full card number.

## Workspaces and team

We store the workspaces you create or join, the members and their roles (owner, admin, editor or viewer), invitations, notification channels (for example an email address, a Slack, Microsoft Teams or Discord webhook address, or a Telegram bot token) and an activity history. API keys are stored as a one-way hash; we can't read them back.

When a workspace asks for outbound calling, we also store the business details provided in the verification (KYC) form and the acceptance of our acceptable use rules, and we keep a record of our review decision.

## Agents and knowledge base

We store each agent's settings: its instructions (prompt), first message, voice, language, tools and the fields it should collect after a call. Knowledge-base documents (uploaded files, the text of web pages you add by address, and text you paste) are stored by us and sent to the voice provider so the agent can use them during calls.

Tool settings can include credentials, such as a Cal.com API key, a webhook secret or a connected Google account used to book appointments or add rows to a spreadsheet. **They are stored encrypted** (AES-256-GCM) and only used to run the tools you configured.

## Contacts and consent records

Businesses can add contacts by CSV upload, through the API or by hand: typically a name, phone number, time zone and any custom fields the business chooses. With each contact, a business can store a **consent record**: the type of consent, its purpose, where and when it was given (source address, date and time, IP address) and a copy of the consent text shown at the time. These records help the business show that it had permission to call.

The business is responsible for having a lawful basis to upload its contacts and to call them.

## Calls, recordings and transcripts

**AI disclosure.** Callers are told at the start of every call that they are speaking with an AI assistant. This message is part of every agent's first message and can't be removed.

For each call we store the phone numbers involved, the time, duration, direction, outcome, cost and the agent and campaign it belongs to. We also store:

- **Transcripts** of what was said by the caller and the agent.
- **Recordings**, only when recording is turned on for the agent. Recording is optional and set per agent. When it is on, a **recording notice** is played at the start of the call. Recordings are copied from the voice provider to the storage chosen by the operator of this platform: our own server's disk, S3-compatible object storage (for example Amazon S3 or Cloudflare R2) or Vercel Blob.
- **Post-call analysis**: a short summary, the caller's sentiment, whether the call reached its goal, and the details the business asked the agent to collect (for example a preferred appointment time). This analysis is produced by the voice provider or by the AI provider chosen by the operator.

Recordings and transcripts are kept according to each workspace's settings. A workspace can set a retention period, after which recordings and transcripts are **deleted automatically**; the call's summary and extracted details stay until the business deletes them.

## Website voice widget and browser calls

A business can add a "Talk to us" voice button to its own website. Until a visitor clicks it, the widget only loads its public settings (button text, colour and position); it sets **no cookies** and stores nothing in the visitor's browser. When the visitor starts a call, the browser asks for permission to use the **microphone**, the visitor is told that they are speaking with an AI assistant (and that the call is recorded, when recording is on), and the audio goes to the voice provider that runs the agent.

Widget calls are stored like phone calls, in the business's workspace: the transcript, the summary, the details collected and, when recording is on, the recording, together with the website the call came from. The widget only works on the websites the business allows. Test calls that team members make from the dashboard in their browser work the same way.

## Opt-outs and do-not-call lists

When someone asks not to be called again, during a call or in any other way, the number is added to the workspace's do-not-call list and is skipped by every future campaign. Businesses can also upload their own do-not-call lists, and we keep a platform-wide list for numbers that asked us directly.

**An opt-out is kept even after the workspace or the contact is deleted**, so that the number isn't called again. We keep only what is needed for that: the phone number, the date and where the opt-out came from.

## If you received a call

If a business called you through {site_name} and you don't want to be called again:

- Say so during the call (for example "please don't call me again"). The agent is instructed to accept the request and end the call, and the number is added to that business's do-not-call list.
- Contact the business that called you. The agent gives the business's name at the start of the call.
- Or write to us at {site_email} with your phone number. We will add it to our platform-wide do-not-call list, so no business on {site_name} calls it, and we will pass any other request (for example access to or deletion of a recording) to the business concerned.

## Sub-processors

We don't sell data and don't share it with advertisers. We share only what is needed with the services that help us run {site_name}. The operator of this platform chooses which of them are used:

- **Voice provider** (ElevenLabs and/or Retell AI), which runs the live call: it receives the agent's settings and knowledge base, the audio of the call and the phone numbers, and returns the transcript, recording and analysis.
- **Telephony carriers** (for example Twilio, SIP trunk providers or Exotel), which connect the calls to the phone network.
- **AI provider** (an OpenAI-compatible API or Anthropic), used for the prompt assistant and, when the voice provider doesn't provide it, for the post-call analysis of transcripts.
- **Payment providers** (Stripe, PayPal or Razorpay) for plans and credits.
- **Email provider** for account emails and notifications.
- **Hosting, database and media storage** providers that store the data, recordings and documents.
- **Calendar and spreadsheet services** (Cal.com, Google Calendar, Google Sheets) and **webhooks** that a business connects as agent tools; they receive the details the agent sends them, such as a booking.
- **Notification destinations** that a business configures (email, Slack, Microsoft Teams, Discord, Telegram or its own webhook), which receive the alerts and call results it asked for.

## How long we keep data

- **Account and workspace data**: while the account exists.
- **Recordings and transcripts**: according to the workspace's retention setting, or until the business deletes them or the workspace. Summaries and extracted details stay until the business deletes them or the workspace.
- **Contacts and consent records**: until the business deletes them or the workspace. Businesses may need to keep consent records for several years to prove consent; they decide how long.
- **Opt-outs**: kept even after deletion, as described above.
- **Audit log** (consent checks, do-not-call checks, dial times, disclosures and opt-outs): append-only, so the business can show how each call was made. It is kept after a workspace is deleted, so that complaints about calls made through {site_name} can still be answered.

When you delete your account or a workspace, its data is deleted, except opt-outs, the audit log and what we must keep by law (for example invoices).

## Security

Passwords are hashed, connections are encrypted, provider keys and tool credentials are stored encrypted with AES-256-GCM, API keys are stored as hashes and access to our servers is restricted. Webhooks from voice providers are checked with a signature before they are accepted. No system is perfectly secure, but we work hard to protect your data.

## Your rights

Customers can see and change their details at any time from their account page, export calls and contacts as CSV and ask us to delete their account. People who were called by a business can ask that business, or us at {site_email}, to stop calling them, and to access or delete their data; we will pass requests about a business's calls to that business. Depending on where you live you may have further rights (for example under the GDPR, including the right to object to direct marketing at any time); contact us to use them.

## Cookies

We only use cookies that are needed for the service to work:

- **tz_session** keeps you signed in (up to 30 days).
- **tz_lang** remembers the language you chose (1 year).
- **dz_ws** remembers the workspace you used last (1 year).
- **dz_oauth** is a short-lived security value (protection against cross-site request forgery) while you connect a Google account for the calendar or spreadsheet tools. It expires after 15 minutes.

Your choice in the cookie notice is saved in your browser's local storage as **dz-cookie-consent**, and your light or dark theme choice as **tz-theme**. Local storage is not a cookie and is never sent to our server. The website voice widget sets no cookies at all. We don't use advertising or third-party tracking cookies.

## Changes

We may update this policy. For important changes we will let customers know by email.

## Contact

For privacy questions, or to be added to our do-not-call list, contact us at {site_email}.`,
  },
  {
    slug: "terms-of-service",
    title: "Terms of Service",
    metaDescription: "The terms that apply when you use {site_name}, including the acceptable use rules for AI phone calls.",
    content: `## Acceptance

By creating an account or using {site_name} you agree to these terms. If you use {site_name} for a company, you confirm that you may accept these terms on its behalf. In these terms, "you" means the customer that owns or uses a workspace.

## Your account and your team

Keep your login details and API keys safe. You are responsible for everything done with your account and in the workspaces you own, including by the members you invite. Give each member the role they need (owner, admin, editor or viewer) and remove access when someone leaves.

## AI agents and accuracy

AI agents can make mistakes. They can misunderstand a caller, give an incomplete or wrong answer, or collect a detail incorrectly. You are responsible for:

- writing your agents' instructions and knowledge base, and keeping them accurate;
- testing every agent before it takes real calls, and supervising it afterwards by reviewing transcripts and call results;
- making sure agents hand off to a human when needed.

**Agents are not for emergencies.** Don't use them where a missed or wrong answer could put someone's health or safety at risk, and tell callers to hang up and call the emergency services when they describe an emergency. Agents don't give medical, legal or financial advice on your behalf unless a qualified person is responsible for that content.

## Acceptable use

You are solely responsible for your calls and for complying with every law that applies to them, in your country and in the countries of the people you call. Depending on where you and they are, this includes, for example:

- in the United States, the Telephone Consumer Protection Act (TCPA) and the FCC's rules (which treat AI-generated voices as artificial voices), the Telemarketing Sales Rule, national and state do-not-call rules, prior express consent and, for telemarketing, prior express written consent, calling-hour limits and state laws on telephone solicitation;
- call-recording laws, including states and countries that require the consent of everyone on the call;
- AI-disclosure duties, such as Article 50 of the EU AI Act and state laws in the United States;
- in Europe and the United Kingdom, the GDPR, the UK GDPR, the ePrivacy rules and the Privacy and Electronic Communications Regulations (PECR), including screening against the Telephone Preference Service where required;
- in India, the TRAI rules on commercial communications, including DLT registration and the use of the 140 series for promotional calls and the 1600 series for service and transactional calls.

You must not use {site_name} to:

- make **unsolicited marketing calls**, or any call, without the consent the law requires for that call;
- call numbers on a do-not-call list, people who asked not to be called, or emergency numbers;
- **impersonate** any person, business, government body or authority, or hide who is calling;
- commit fraud or run scams, phishing or deceptive offers;
- harass, threaten or intimidate anyone, or make abusive debt-collection calls;
- make political or election calls without the consent the law requires;
- make an agent claim to be human, or deny being an AI when a caller asks;
- collect card numbers, bank details, passwords, one-time codes or similar secrets through an agent;
- remove or hide the AI disclosure, or record calls without the notice and consent the law requires;
- get around plan limits, calling-hour rules, do-not-call checks or our review, or resell access without our permission.

**Outbound calling needs approval.** Before a workspace can make outbound calls, you must complete the verification (KYC) form and accept these rules, and we must approve the workspace. We may ask for more information at any time.

**Review and enforcement.** To protect callers, carriers and other customers, we may review agents, campaigns, contact sources and call records; refuse or revoke outbound access; pause campaigns; stop all calls of a workspace or of the whole platform at once (a kill switch); suspend or close accounts; and keep audit logs of consent checks, do-not-call checks, dial times, disclosures and opt-outs. We may also share information with carriers, providers or authorities when the law requires it or to stop abuse.

**Compliance features are tools, not legal advice.** {site_name} includes features that help you comply: AI disclosure in the first message, consent records, do-not-call scrubbing, calling hours by time zone, opt-out detection and an audit log. They don't make your calls lawful on their own, and they don't replace advice from a lawyer who knows your situation. You decide who to call, why and when.

## Phone numbers and third-party providers

Calls run through third-party voice providers and telephony carriers chosen by the operator of this platform, and you also agree to the terms and policies of those providers and carriers that apply to the numbers and services you use. Some countries and number types require identity or business documents (regulatory KYC) before a number can be used; we may pass them to the carrier.

Phone numbers are not your property. A number can be reclaimed or released if the rental is not paid, if a provider or carrier withdraws it, or if it is used against these terms. Providers may change their prices, features or availability, and calls can fail or be delayed when a provider or carrier has a problem. Call quality, delay and connection rates depend on networks we don't control.

## Credits and billing

- **Plans** may include a number of call minutes and set limits such as agents, phone numbers, team members and concurrent calls, as shown on the pricing page. The limits count across all the workspaces you own.
- **Some features are only available on plans that include them**, such as outbound calls, campaigns, your own voice provider keys, the REST API and white label. Using a feature your plan doesn't include, or getting around a limit, is not allowed.
- **Wallet credits** pay for minutes beyond your plan and for other usage. Calls are charged per minute at the price shown in your dashboard (Billing), using the billing increment and minimum charge shown there. Phone number rental is charged monthly.
- Before an outbound call starts, an amount may be reserved from your balance; after the call, the billed duration is charged and the rest is released. Calls can't start when the balance is too low.
- Paid plans renew or expire according to the billing period you chose. You can change or cancel your plan at any time.
- **Credits and paid periods are not refundable**, except where the law requires it or where a charge was clearly made in error. Credits have no cash value and can't be transferred.

## Availability

We work hard to keep {site_name} available, but we don't guarantee that it will always work without interruption. We may pause service for maintenance, and we depend on voice providers, carriers and other services outside our control.

## Your content

You keep all rights to your agents, knowledge base, contacts, recordings and other content. You give us permission to store and process them, and to send them to the providers that run your calls, only to provide the service to you. You confirm that you have the right to upload them and to use them as you do.

## Liability

The service is provided "as is", without warranties of any kind. We are not responsible for what your agents say, for calls you choose to make, or for fines, claims or losses that result from your calls. You agree to compensate us for claims made against us because of your calls or your breach of these terms. To the extent the law allows, our liability is limited to the amount you paid us in the last 12 months.

## Changes

We may update these terms. We will let customers know about important changes; continued use after a change means you accept the new terms.

## Contact

Questions about these terms? Write to {site_email}.`,
  },
];
