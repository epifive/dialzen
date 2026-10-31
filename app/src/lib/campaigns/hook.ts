import "server-only";
import { addCallHook } from "../voice/hooks";
import { onCallEnded } from "./outcomes";

/**
 * Registers the campaign engine with the webhook ingest: when a campaign call reaches its final
 * status, its campaign row is completed or scheduled for a retry right away (the engine's polling
 * is the fallback). Imported by src/lib/voice/index.ts.
 */
addCallHook(async (call, kind) => {
  if (kind === "finished" && call.campaignId) await onCallEnded(call);
});

export const campaignHooksReady = true;
