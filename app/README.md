# Dialzen

AI voice call agent SaaS built with **Next.js 16**, **React 19** and **Tailwind CSS 4**. Businesses
create AI phone agents for **inbound support, appointment booking and consented follow-ups**:
agents answer calls on their phone numbers, use a knowledge base and tools (Cal.com / Google
Calendar booking, webhooks, Google Sheets, transfer to a person), and every call is logged with
its recording, transcript, summary, sentiment and extracted data.

Dialzen is the **control plane**: agents, knowledge base, tools, phone numbers, contacts, consent
records, do-not-call lists, campaigns, call credits and compliance live in your database. A
managed voice provider (**ElevenLabs Agents** or **Retell AI**, plus a **Simulated** provider for
demos and tests) runs the realtime audio loop, so the app needs no media server and runs on
Vercel, a VPS, Docker or Node.js hosting: REST calls go out, signed HTTPS webhooks come in.

Includes workspaces with roles and invites, plans with limits, a per-minute credit wallet with
reserve-then-settle billing and tenant P&L, four payment gateways, notification channels (email,
signed webhook, Slack, Discord, Microsoft Teams, Telegram), a REST API, an embeddable web widget,
a blog, multi-language/RTL and a full admin panel.

> The compliance features (AI disclosure, consent capture, DNC scrubbing, calling hours by the
> callee's time zone, opt-out detection, outbound approval, kill switches, audit log) are tools,
> not legal advice. The operator and its customers are responsible for the telemarketing, consent
> and recording rules that apply to their calls.

The complete guide is in [`documentation/index.html`](../documentation/index.html) (open it in a browser).

## Quick start (local)

```bash
npm install
npm run dev
```

Open http://localhost:3000. You are redirected to the web installer at `/install`.
Choose **SQLite** for a zero-setup local database (Node.js 22.13+), or **MySQL** for production.

`npm run dev` and `npm run build` first bundle the web widget (`predev` / `prebuild` →
`scripts/build-widget.mjs`, esbuild from the dev dependencies) into `public/dz-widget.js` and
`public/dz-widget-call.js`. Those two files are generated: they are not in the repository.

Voice providers send webhooks to a public `https://` address, so on `localhost` use the
**Simulated** provider (Admin → Settings → Voice providers → Testing → Allow the simulated provider) or an
HTTPS tunnel as the Site URL.

Background jobs run in "lazy mode" by default (after page views, at most once a minute).
Campaigns only dial on time when something runs the jobs every minute: start the worker in a
second terminal with the secret from Admin → System → Scheduler, or call the cron URL from a
cron job:

```bash
CRON_SECRET=the-secret-from-admin npm run worker
```

## Production

```bash
npm ci               # dev dependencies are needed for the build (esbuild, Tailwind, TypeScript)
npm run build
npm start            # or: node server.js  (cPanel / Passenger / PM2)
```

Requirements: Node.js 20.9+ (22.13+ for the SQLite option), MySQL 5.7+/MariaDB 10.3+/TiDB
(recommended) or the built-in SQLite option, **HTTPS on a public domain** (provider webhooks,
tool endpoints, microphone access), a **1-minute scheduler** (cron URL or worker), file storage
(local disk, S3-compatible or Vercel Blob), outbound HTTPS to the voice providers, and SMTP.

### Secrets

| Variable | Why |
| -------- | --- |
| `CRON_SECRET` | Protects `/api/cron/tick` and `/api/cron/campaigns` and is used by the worker. **12+ random characters** (e.g. `openssl rand -hex 24`); shorter values and the example `change-me-to-a-long-random-string` are ignored. Without it, a secret is generated and shown in Admin → System → Scheduler. |
| `APP_SECRET` | 16+ characters. Encrypts workspaces' own provider keys, tool credentials (Cal.com keys, Google tokens) and carrier logins (AES-256-GCM, key = HKDF(secret, purpose)) and signs widget keys, recording links, upload tokens and OAuth state. Without it, one is generated in `storage/config.json` (or a `settings` row on read-only disks). **Set it on Vercel and whenever several servers/containers run the app**, and never change it afterwards. |

### Background jobs and the worker

Every "tick" (`src/lib/scheduler.ts`) runs the jobs of `src/lib/jobs/index.ts` in order, within a
time budget, with a lock so ticks never overlap: `voice-sync` (simulated call events, agent sync
retries), `campaigns` (the dialer), `auto-recharge`, `low-balance`, `dnc-expiry`, `retention`,
`recordings`, `reconcile` (idle browser calls every minute, live phone calls without news for
10 minutes every 10 minutes, number rentals hourly, provider reconciliation nightly with a cursor
and `calls.reconciled_at`) and `housekeeping`. Something must start ticks:

| Method | How | Notes |
| ------ | --- | ----- |
| Cron URL | `curl -fsS -m 70 "https://your-site/api/cron/tick?key=SECRET"` **every minute** | cPanel, shared hosting, Vercel (external cron service). Also accepts `Authorization: Bearer SECRET`. 45 s budget. |
| Worker | `CRON_SECRET=… npm run worker` (calls the cron URL every 15 s) | VPS / Docker. `WORKER_URL`, `WORKER_INTERVAL_SEC` (default 15, min 5). |
| Campaign URL | `/api/cron/campaigns` (same secret) | Optional: only the dialer, lease-based, safe to call more often than once a minute. |
| Lazy mode | On by default (Admin → Settings → Scheduler) | Only while there is activity. Not for production. |

- **PM2:** `ecosystem.config.cjs` starts the app (`dialzen`) and the worker (`dialzen-worker`).
- **Docker:** `docker-compose.yml` runs `app`, `worker` and MySQL 8.4; it needs `CRON_SECRET`.

### File storage

`src/lib/media/storage.ts`: `local` (`storage/uploads/media`, served by `/api/media/f/<key>`),
`s3` (AWS S3, Cloudflare R2, MinIO, Wasabi, B2; presigned uploads) and `blob` (Vercel Blob).
Admin → Settings → Media storage, overridden by `STORAGE_DRIVER`, `S3_*` and
`BLOB_READ_WRITE_TOKEN`. Knowledge-base files are read from storage and uploaded to the voice
provider when an agent syncs (only knowledge-base *web pages* are fetched by the provider from
their URL). Call recordings are copied under `recordings/` by the `recordings` job and are never
served by the public file route: members play them through `/api/voice/recordings/<callId>` with
a signed, expiring link. With "Copy call recordings to media storage" off, and always on Vercel
Blob (public files), nothing is copied: that route streams the provider's audio instead.

## Architecture

- `src/voice/` is the contract shared by every part of the app (dependency-free):
  - `types.ts`: the `VoiceProvider` adapter interface, `ProviderContext`, `ProviderError`,
    normalised call events, call statuses and end reasons, agent settings, tool configs, consent,
    DNC, campaigns, compliance settings, roles and notification events.
  - `normalize.ts`: E.164 parsing (built-in country table), time zones and calling hours (DST via
    `Intl`), US state presets, `canDial()`, opt-out detection (English, Hindi, Arabic), the AI
    disclosure, prompt variables, credit maths, roles and settings normalisers.
  - `templates.ts`: 8 agent templates. `format.ts`: durations, money in micros, status tones.
- `src/lib/voice/`: the adapters (`elevenlabs.ts`, `retell.ts`, `simulated.ts`, registered with
  `registerProvider()` in `src/lib/providers.ts`), `http.ts` (provider requests and error
  mapping), `ingest.ts` (webhook verification → normalised events → call rows → billing,
  opt-outs, recordings, notifications, campaign hooks; idempotent via `webhook_events`),
  `sync.ts`, `outbound.ts`, `web-call.ts`, `numbers.ts` (buy/import/route/release, rentals),
  `twilio.ts` (number ownership check), `recordings.ts`, `reconcile.ts` (+ tenant P&L),
  `vars.ts` (prompt variables → provider variables), `sim-script.ts` / `sim-store.ts`.
- `src/lib/tools/`: the tool runtime (`runtime.ts`: Cal.com API v2, Google Calendar free/busy +
  events, Google Sheets append, signed webhooks), `execute.ts` (`/api/voice/tools/<id>?agent=<id>`
  with the per agent-and-tool secret `X-Dialzen-Tool-Secret`), `google-oauth.ts`
  (`/api/oauth/google/start` and `/callback`, PKCE).
- `src/lib/campaigns/`: campaign records (`index.ts`), the lease-based dialer (`engine.ts`) and
  outcomes (retries, abandonment guard, completion).
- `src/lib/`: `agents`, `kb`, `numbers`, `contacts` (lists, consent, DNC, opt-outs),
  `contacts-import`, `dnc`, `calls`, `wallet` (atomic reserve / settle / release),
  `billing` (prices, credit packs, P&L), `compliance` (settings, KYC, kill switches,
  `checkDial()`), `audit` (append-only log), `providers` (adapter registry, platform and BYO keys,
  sell prices), `widget`, `analytics`, `plans`, `usage`, `workspaces`, `ai` (OpenAI-compatible and
  Anthropic adapter), `notify`, `media`, `payments`, `erasure` (erasure requests: delete a
  recording, erase a call to an anonymous billing row, erase a contact's data while keeping its
  DNC entry), `webhook-signature` (the signature of every outgoing webhook).
- `src/lib/voice/cleanup.ts`: when a workspace or user is deleted, stops its campaigns, closes
  live calls, releases its numbers and deletes its agents and knowledge-base documents at the
  providers; failures go to Admin → Voice providers ("Provider cleanup failed", Retry).
- `src/widget/`: the embeddable widget (`loader.ts` ≤ 3 KB gzip, `call.ts` ≤ 16 KB gzip,
  `sdk.ts`). The provider browser SDKs are vendored in `public/vendor/voice-sdk` with
  `LICENSES.txt` (`npm run vendor:voice-sdk` refreshes them; versions in
  `scripts/vendor-voice-sdks.mjs`).
- Database: Kysely on SQLite or MySQL/MariaDB/TiDB with versioned migrations
  (`src/lib/db/migrations.ts`) that run automatically. Timestamps are ISO strings, JSON is text,
  money for calls is in **micros** of the site currency, phone numbers are E.164.
- Limits belong to the workspace owner's plan and count across all workspaces the owner owns:
  `-1` = unlimited, `0` = none.

### Call life cycle

```
startOutboundCall / startWebCall / inbound (provider)
  → checkDial() (outbound only) → concurrency caps → credit hold (reserveForCall)
  → calls row (queued) → provider.startCall / createWebCall with tenant tags
  → webhooks /api/voice/webhook/<provider> → started → ended → analysis_ready
  → billCall (included minutes, then settle) → opt-out → recording copy → notifications → campaign hook
```

### Webhook and callback URLs

| URL | Who calls it |
| --- | --- |
| `/api/voice/webhook/elevenlabs` | ElevenLabs post-call webhook (pasted by the operator, HMAC secret in Settings → Voice providers; BYO workspaces paste it in their own account, secret in workspace Settings → Voice provider keys) |
| `/api/voice/webhook/retell` | Retell agent and inbound webhooks (set automatically on sync; signed with the API key) |
| `/api/voice/webhook/simulated` | The simulated provider (signed with a key derived from `APP_SECRET`) |
| `/api/voice/tools/<toolId>?agent=<agentId>` | Providers during calls (`X-Dialzen-Tool-Secret`) |
| `/api/oauth/google/callback` | Google OAuth redirect URI |
| `/api/widget/<agentKey>`, `/token`, `/chat` | The web widget (origin-checked, CORS) |
| `/api/payments/stripe/webhook` | Stripe |

## REST API

`/api/v1`, `Authorization: Bearer dz_…` (keys in Dashboard → API keys; one workspace per key, the
creator's role; the owner's plan needs API access; a banned owner's workspaces get 403).
Endpoints: `workspace`, `agents`, `numbers`, `lists` (`GET`, `POST`), `calls` (`POST` places a
call after the compliance check, `DELETE /calls/{id}` erases a finished call, admin keys),
`contacts` (with consent records), `dnc`, `dnc/check`, `campaigns` (+ `start`, `pause`),
`webhooks`. Errors are `{ "error": "…" }` with 401/402/403/404/409/413/422/429/502; `POST /calls`
answers 402 `insufficient_credits` when the credits can't cover the call, and a call refused by the
compliance check is `422 { "error": "blocked", "reasons": [...], "retry_at": … }`. 600 requests/min
per key, 120 writes/min.

Every outgoing webhook (notification channels, API webhooks, webhook tools and their test) carries
`X-Dialzen-Timestamp` (Unix seconds) and, with a secret, `X-Dialzen-Signature: sha256=<hex
HMAC-SHA256(secret, "<timestamp>.<raw body>")>` (`src/lib/webhook-signature.ts`). Receivers
should reject timestamps older than 5 minutes.

## Scripts

| Command                    | Description                                                        |
| -------------------------- | ------------------------------------------------------------------ |
| `npm run dev`              | Build the widget, then start the development server               |
| `npm run build`            | Build the widget (`prebuild`), then the production app            |
| `npm start`                | Start the production server                                        |
| `npm run start:server`     | Start via `server.js` (hosting panels, PM2)                        |
| `npm run worker`           | Run a scheduler tick every 15 s (needs `CRON_SECRET`)              |
| `npm run widget:build`     | Rebuild `public/dz-widget.js` and `public/dz-widget-call.js` only  |
| `npm run vendor:voice-sdk` | Re-download and rebuild the vendored provider browser SDKs         |
| `npm run lint`             | ESLint                                                             |
| `npm run typecheck`        | TypeScript check                                                   |

## Extending

- **A voice provider:** implement `VoiceProvider` (`src/voice/types.ts`) in
  `src/lib/voice/<id>.ts` with `providerRequest()`/`apiBase()` from `http.ts`, tag calls with
  `encodeCallTags()`, give events stable ids, call `registerProvider()`, import it in
  `src/lib/voice/index.ts`; add the id to `PROVIDERS`, its keys to `src/lib/settings.ts`
  (+ `SECRET_SETTINGS`), the admin fields in `src/app/admin/settings/sections.ts`, and cases in
  `platformKeys()` / `sellPricePerMinMicros()` (`src/lib/providers.ts`). See the documentation.
- **A tool kind:** add it to `TOOL_KINDS` / `ToolConfigByKind` (`src/voice/types.ts`), its
  normaliser, the runtime in `src/lib/tools/runtime.ts` and the form in
  `src/components/dashboard/tool-forms.tsx`.
- **A background job:** a `Job` in `src/lib/jobs/`, registered in `JOBS` (housekeeping last).

## Environment variables

Optional; the web installer writes `storage/config.json`. `.env.example` lists every variable the
code reads: database (`DATABASE_URL` or `DB_*`), `APP_INSTALLED`, `ADMIN_*`, `SITE_URL`,
`STORAGE_DIR`, `PORT`/`HOST`, `TRUSTED_PROXY_HOPS`, `CRON_SECRET`, `APP_SECRET`, `WORKER_URL`,
`WORKER_INTERVAL_SEC`, file storage (`STORAGE_DRIVER`, `S3_*`, `BLOB_READ_WRITE_TOKEN`),
`DEMO_MODE`, `DEMO_SEED` and `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`.

Testing / single-company only, never on a public platform: `ALLOW_PRIVATE_WEBHOOKS` (webhook
tools, self-hosted Cal.com and webhook notifications may reach private addresses),
`DIALZEN_TEST_ELEVENLABS_API`, `DIALZEN_TEST_RETELL_API`, `DIALZEN_TEST_TWILIO_API`,
`DIALZEN_TEST_GOOGLE_API`, `DIALZEN_TEST_CALCOM_API` (send those APIs' requests to a mock
server), `DIALZEN_SIM_SPEED` (time compression of simulated calls), `AI_ANTHROPIC_BASE_URL`
(mock Anthropic API), `NEXT_DIST_DIR`.
