import Link from "next/link";
import "@/lib/voice";
import { Card, PageHeader, StatCard, Table, Td, Th } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { getProvider, platformKeys, simulatedAllowed } from "@/lib/providers";
import { readRaw } from "@/lib/scheduler";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { formatDate } from "@/lib/utils";
import { formatMicros, providerName } from "@/voice/format";
import { parseJson, toMicros } from "@/voice/normalize";
import { PROVIDERS, type ProviderId } from "@/voice/types";
import { CopyValue } from "../system/scheduler-forms";
import { cleanupLeftovers } from "@/lib/voice/cleanup";
import { ListVoicesForm, ReconcileNowForm, RetryCleanupForm, TestProviderForm } from "./voice-forms";

export const metadata = { title: "Voice providers" };

const DAY_MS = 86_400_000;

/** Provider health figures of the last 24 hours. */
async function loadHealth() {
  const db = await getDb();
  const since = new Date(Date.now() - DAY_MS).toISOString();
  return Promise.all([
    db.selectFrom("webhook_events").select(["provider", "status", (eb) => eb.fn.countAll<number>().as("n")]).where("received_at", ">=", since).groupBy(["provider", "status"]).execute(),
    db.selectFrom("webhook_events").select(["provider", (eb) => eb.fn.max("received_at").as("last")]).groupBy("provider").execute(),
    db.selectFrom("agents").select(["provider", "sync_status", (eb) => eb.fn.countAll<number>().as("n")]).groupBy(["provider", "sync_status"]).execute(),
    db.selectFrom("calls").select(["provider", (eb) => eb.fn.countAll<number>().as("n"), (eb) => eb.fn.sum<number>("duration_sec").as("sec"), (eb) => eb.fn.sum<number>("provider_cost_micros").as("cost")]).where("created_at", ">=", since).groupBy("provider").execute(),
    db.selectFrom("calls").select(["provider", (eb) => eb.fn.countAll<number>().as("n")]).where("status", "in", ["queued", "ringing", "in_progress"]).groupBy("provider").execute(),
    db.selectFrom("webhook_events").select(["id", "provider", "event_id", "status", "error", "received_at"]).where("status", "in", ["error", "ignored"]).where("provider", "!=", "dialzen").orderBy("id", "desc").limit(10).execute(),
    readRaw("voice_reconcile_last"),
  ]);
}

export default async function VoiceProvidersPage() {
  const settings = await getSettings();
  const [events, lastEvents, agents, calls, live, errors, reconcileRaw] = await loadHealth();
  const leftovers = await cleanupLeftovers();
  const reconcile = parseJson(reconcileRaw) as { at?: string; checked?: number; completed?: number; drift?: number; failed?: number; errors?: number } | null;
  const n = (v: unknown) => Number(v ?? 0).toLocaleString("en-US");
  const count = <T extends { provider: string; n: number | string | bigint }>(rows: T[], id: string, pick?: (r: T) => boolean) => rows.filter((r) => r.provider === id && (!pick || pick(r))).reduce((s, r) => s + Number(r.n), 0);
  const url = (path: string) => absoluteUrl(settings, path);
  const price: Record<ProviderId, number> = { elevenlabs: toMicros(settings.voice_price_elevenlabs), retell: toMicros(settings.voice_price_retell), simulated: toMicros(settings.voice_price_simulated) };
  const httpsWarning = !absoluteUrl(settings).startsWith("https://");

  return (
    <>
      <PageHeader
        title="Voice providers"
        description="Health of the providers that run your customers' calls, the webhook addresses to paste into their dashboards, and the nightly reconciliation."
        actions={
          <>
            <Link href="/admin/settings/voice" className={buttonClass("outline", "sm")}>
              Keys and prices
            </Link>
            <Link href="/admin/voice/pnl" className={buttonClass("primary", "sm")}>
              Tenant P&amp;L
            </Link>
          </>
        }
      />
      {httpsWarning ? (
        <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          The site URL is not an https:// address. Voice providers can only reach webhooks and tool endpoints over public HTTPS: set the final address in Settings → General → Site URL.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {PROVIDERS.map((id) => {
          const adapter = getProvider(id);
          const configured = id === "simulated" ? simulatedAllowed(settings) : Boolean(platformKeys(settings, id).apiKey);
          const lastEvent = lastEvents.find((r) => r.provider === id)?.last as string | undefined;
          const evOk = count(events, id, (r) => r.status === "processed");
          const evBad = count(events, id, (r) => r.status === "error");
          const evIgnored = count(events, id, (r) => r.status === "ignored");
          const synced = count(agents, id, (r) => r.sync_status === "synced");
          const syncErr = count(agents, id, (r) => r.sync_status === "error");
          const c = calls.find((r) => r.provider === id);
          return (
            <Card
              key={id}
              title={providerName(id)}
              actions={configured ? <Badge tone="success">{id === "simulated" ? "Allowed" : "Configured"}</Badge> : <Badge tone="warning">{id === "simulated" ? "Off" : "No API key"}</Badge>}
            >
              <dl className="divide-y divide-line text-sm">
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">Sell price</dt>
                  <dd>{formatMicros(price[id], settings.currency, "en-US", true)} / min</dd>
                </div>
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">Agents (synced / errors)</dt>
                  <dd>
                    {n(synced)} / {syncErr ? <Badge tone="danger">{n(syncErr)}</Badge> : "0"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">Calls 24 h (live now)</dt>
                  <dd>
                    {n(c?.n)} ({n(count(live, id))})
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">Minutes / provider cost 24 h</dt>
                  <dd>
                    {(Number(c?.sec ?? 0) / 60).toFixed(1)} / {formatMicros(Number(c?.cost ?? 0), settings.currency, "en-US", true)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">Webhooks 24 h</dt>
                  <dd>
                    {n(evOk)} ok{evIgnored ? ` · ${n(evIgnored)} ignored` : ""}
                    {evBad ? (
                      <>
                        {" · "}
                        <Badge tone="danger">{n(evBad)} errors</Badge>
                      </>
                    ) : null}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">Last webhook</dt>
                  <dd>{lastEvent ? formatDate(lastEvent, true) : "Never"}</dd>
                </div>
              </dl>
              {adapter ? (
                <div className="mt-4 space-y-4 border-t border-line pt-4">
                  <TestProviderForm provider={id} disabled={!configured} />
                  {configured ? <ListVoicesForm provider={id} /> : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Webhook and callback addresses">
          <div className="space-y-5 text-sm">
            <div>
              <p className="mb-1 font-medium">ElevenLabs post-call webhook</p>
              <CopyValue value={url("/api/voice/webhook/elevenlabs")} label="ElevenLabs webhook URL" wrap />
              <p className="mt-1.5 text-xs text-muted">
                ElevenLabs → Agents → Settings → Post-call webhook: create an HMAC webhook with this URL, enable the transcript and call initiation failure events, and paste its secret into Settings → Voice providers.{" "}
                {settings.elevenlabs_webhook_secret ? <Badge tone="success">Secret saved</Badge> : <Badge tone="warning">No secret yet</Badge>}
              </p>
            </div>
            <div>
              <p className="mb-1 font-medium">ElevenLabs inbound call variables</p>
              <CopyValue value={url("/api/voice/inbound/elevenlabs")} label="ElevenLabs initiation webhook URL" wrap />
              <p className="mt-1.5 text-xs text-muted">Set on every ElevenLabs agent automatically when it syncs (conversation initiation webhook with a per-agent X-Dialzen-Inbound-Secret header), so inbound calls get the caller, contact and business variables. Only set while the site URL is public HTTPS.</p>
            </div>
            <div>
              <p className="mb-1 font-medium">Retell agent and inbound webhooks</p>
              <CopyValue value={url("/api/voice/webhook/retell")} label="Retell webhook URL" wrap />
              <p className="mt-1.5 text-xs text-muted">Set on every agent and number automatically when they sync. Retell signs webhooks with the API key: use a key marked “webhook” in the Retell dashboard.</p>
            </div>
            <div>
              <p className="mb-1 font-medium">Tool endpoints</p>
              <CopyValue value={url("/api/voice/tools/")} label="Tool endpoint base" wrap />
              <p className="mt-1.5 text-xs text-muted">Registered with the provider for every server tool (booking, webhook, Google Sheets) as /api/voice/tools/&lt;tool&gt;?agent=&lt;agent&gt; with a per-agent secret header.</p>
            </div>
            <div>
              <p className="mb-1 font-medium">Google OAuth redirect URI</p>
              <CopyValue value={url("/api/oauth/google/callback")} label="Google redirect URI" wrap />
              <p className="mt-1.5 text-xs text-muted">Google Cloud → APIs &amp; Services → Credentials → your OAuth client. Enable the Google Calendar API and the Google Sheets API.</p>
            </div>
          </div>
        </Card>
        <Card title="Reconciliation" actions={reconcile?.at ? <Badge>{formatDate(reconcile.at, true)}</Badge> : <Badge tone="warning">Not run yet</Badge>}>
          <p className="text-sm text-muted">
            Every night the last 48 hours of calls are compared with the providers&apos; records: calls whose final webhook never arrived are completed and billed, duration and cost drift is corrected and written to the audit log, and calls stuck as live are closed so their reserved credits come back.
          </p>
          {reconcile?.at ? (
            <div className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Checked" value={n(reconcile.checked)} />
              <StatCard label="Completed" value={n(reconcile.completed)} />
              <StatCard label="Corrected" value={n(reconcile.drift)} />
              <StatCard label="Closed" value={n(reconcile.failed)} />
            </div>
          ) : (
            <div className="my-4" />
          )}
          <ReconcileNowForm />
        </Card>
      </div>

      {leftovers.length ? (
        <Card title="Provider cleanup failed" className="mt-6" actions={<Badge tone="danger">{n(leftovers.length)}</Badge>}>
          <p className="mb-4 text-sm text-muted">
            These numbers, agents and documents of deleted workspaces, and copies of erased calls, could not be removed at the provider. Bought numbers keep costing you every month until they are released, and erased calls must not stay at the provider: retry here (with the site&apos;s keys, or a workspace&apos;s own keys while they are saved), or delete them in the provider&apos;s dashboard.
          </p>
          <Table minWidth={640} dense>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Workspace</Th>
                <Th>What</Th>
                <Th>Error</Th>
              </tr>
            </thead>
            <tbody>
              {leftovers.slice(-50).map((l, i) => (
                <tr key={`${l.kind}-${l.ref}-${i}`}>
                  <Td className="whitespace-nowrap">{formatDate(l.at, true)}</Td>
                  <Td>
                    {l.workspaceName} <span className="text-xs text-muted">#{l.workspaceId}</span>
                  </Td>
                  <Td>
                    {providerName(l.provider)} {l.kind} <span className="font-mono text-xs break-all">{l.kind === "call" ? `${l.label} · ${l.ref}` : l.label || l.ref}</span>
                    {l.keySource === "byo" ? <span className="text-xs text-muted"> (own keys)</span> : null}
                  </Td>
                  <Td className="text-xs break-words">{l.error}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4">
            <RetryCleanupForm byo={leftovers.filter((l) => l.keySource === "byo").length} />
          </div>
        </Card>
      ) : null}

      <Card title="Recent webhook problems" className="mt-6" padded={false}>
        {errors.length ? (
          <Table minWidth={560} dense>
            <thead>
              <tr>
                <Th>Received</Th>
                <Th>Provider</Th>
                <Th>Event</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap">{formatDate(e.received_at, true)}</Td>
                  <Td>{providerName(e.provider)}</Td>
                  <Td className="font-mono text-xs break-all">{e.event_id}</Td>
                  <Td>
                    <Badge tone={e.status === "error" ? "danger" : "neutral"}>{e.status}</Badge> <span className="text-xs text-muted">{e.error ?? ""}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="px-5 py-4 text-sm text-muted">No failed or unmatched webhooks.</p>
        )}
      </Card>
    </>
  );
}
