import "server-only";
import type { CallRecord } from "@/lib/calls";

/**
 * Extension points of the webhook ingest for other modules (campaign engine, REST webhooks…).
 * Handlers run after a call reached its final status and was billed ("finished"), and again when
 * the provider's analysis arrived ("analyzed"); each at most once per call. They must be
 * idempotent and quick; errors are logged and never break the ingest.
 *
 * Register from a module that the webhook route imports (e.g. add an import to
 * src/lib/voice/index.ts). The campaign engine can also simply poll calls by campaign_contact_id:
 * the ingest is the only writer of final call statuses.
 */

export type CallHookKind = "finished" | "analyzed";
export type CallHook = (call: CallRecord, kind: CallHookKind) => Promise<void> | void;

const hooks: CallHook[] = [];

export function addCallHook(hook: CallHook): void {
  if (!hooks.includes(hook)) hooks.push(hook);
}

export async function runCallHooks(call: CallRecord, kind: CallHookKind): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(call, kind);
    } catch (error) {
      console.error(`[dialzen] call hook (${kind}) failed:`, error);
    }
  }
}
