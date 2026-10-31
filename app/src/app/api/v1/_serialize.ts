import "server-only";
import type { AgentRecord } from "@/lib/agents";
import type { CallRecord } from "@/lib/calls";
import type { CampaignProgress, CampaignRecord } from "@/lib/campaigns";
import type { ContactList, ContactRecord } from "@/lib/contacts";
import type { NumberRecord } from "@/lib/numbers";
import type { NotifyChannelRecord } from "@/lib/notify-channels";
import type { Consent } from "@/voice/types";

/**
 * JSON shapes of the REST API v1 (snake_case keys, ISO times, money in micros of the site
 * currency). Secrets, provider internals and full prompts are never included.
 */

export function agentJson(a: AgentRecord) {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    provider: a.provider,
    language: a.language,
    voice_name: a.voiceName,
    first_message: a.firstMessage,
    sync_status: a.syncStatus,
    max_duration_sec: a.settings.maxDurationSec,
    recording: a.settings.recording,
    analysis_fields: a.settings.analysisFields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options })),
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

export function callJson(c: CallRecord, options: { transcript?: boolean } = {}) {
  return {
    id: c.id,
    direction: c.direction,
    status: c.status,
    end_reason: c.endReason,
    outcome: c.outcome,
    agent_id: c.agentId,
    campaign_id: c.campaignId,
    contact_id: c.contactId,
    number_id: c.numberId,
    from: c.from,
    to: c.to,
    provider: c.provider,
    queued_at: c.queuedAt,
    started_at: c.startedAt,
    ended_at: c.endedAt,
    duration_sec: c.durationSec,
    billed_seconds: c.billedSeconds,
    included_seconds: c.includedSeconds,
    credits_micros: c.creditsSettledMicros,
    summary: c.summary,
    sentiment: c.sentiment,
    extracted: c.extracted,
    disclosure_played: c.disclosurePlayed,
    has_recording: Boolean(c.recording) || Boolean(c.recordingUrl),
    ...(options.transcript ? { transcript: c.transcript, tool_calls: c.toolCalls.map((t) => ({ name: t.name, ok: t.ok, at: t.at })) } : {}),
    created_at: c.createdAt,
  };
}

export function consentJson(k: Consent) {
  return { id: k.id, type: k.type, purpose: k.purpose, source: k.source, source_url: k.sourceUrl, captured_at: k.capturedAt, ip: k.ip, text: k.textSnapshot, expires_at: k.expiresAt, revoked_at: k.revokedAt };
}

export function contactJson(c: ContactRecord) {
  return {
    id: c.id,
    phone: c.phone,
    first_name: c.firstName,
    last_name: c.lastName,
    email: c.email,
    company: c.company,
    country: c.country,
    timezone: c.timezone,
    state: c.state,
    language: c.language,
    fields: c.fields,
    tags: c.tags,
    source: c.source,
    opted_out_at: c.optedOutAt,
    last_called_at: c.lastCalledAt,
    calls_count: c.callsCount,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

export function campaignJson(c: CampaignRecord, progress?: CampaignProgress) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    paused_reason: c.pausedReason,
    purpose: c.purpose,
    agent_id: c.agentId,
    number_ids: c.numberIds,
    list_ids: c.listIds,
    starts_at: c.startsAt,
    ends_at: c.endsAt,
    calling_window: c.window,
    timezone_mode: c.timezoneMode,
    timezone: c.timezone,
    max_attempts: c.maxAttempts,
    retry_on: c.retryOn,
    retry_delays_min: c.retryDelays,
    concurrency: c.concurrency,
    daily_cap: c.dailyCap,
    variables: c.variables,
    abandon_max_pct: c.abandonMaxPct,
    ...(progress
      ? {
          progress: {
            total: progress.total,
            done: progress.done,
            attempts: progress.attempts,
            states: progress.states,
            outcomes: progress.outcomes,
            next_attempt_at: progress.nextAttemptAt,
          },
        }
      : {}),
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    completed_at: c.completedAt,
  };
}

export function webhookJson(c: NotifyChannelRecord) {
  const cfg = c.config as { url: string; secret: string };
  return { id: c.id, name: c.name, url: cfg.url, has_secret: Boolean(cfg.secret), events: c.events, active: c.isActive, created_at: c.createdAt };
}

export function numberJson(n: NumberRecord) {
  return {
    id: n.id,
    e164: n.e164,
    country: n.country,
    label: n.label,
    provider: n.provider,
    carrier: n.carrier,
    status: n.status,
    inbound_agent_id: n.inboundAgentId,
    outbound_agent_id: n.outboundAgentId,
    outbound_enabled: n.outboundEnabled,
    kyc_status: n.kycStatus,
    daily_dial_cap: n.dailyDialCap,
    created_at: n.createdAt,
    released_at: n.releasedAt,
  };
}

export function listJson(l: ContactList) {
  return { id: l.id, name: l.name, description: l.description, members: l.members, created_at: l.createdAt };
}

/** 422 with machine-readable details. */
export function unprocessable(error: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, ...extra }, { status: 422, headers: { "Cache-Control": "no-store" } });
}
