import "server-only";
import "./elevenlabs";
import "./retell";
import "./simulated";
import "./sim-store";
// The campaign engine's call hook (agent C): finished campaign calls update their campaign row at once.
import "@/lib/campaigns/hook";

/**
 * Registers every voice provider adapter (ElevenLabs Agents, Retell AI, Simulated) and the
 * simulated-call scheduler. Import this module (or any service of src/lib/voice that imports it)
 * before calling getProvider() / providerContext() from src/lib/providers.ts.
 */
export function voiceProvidersReady(): true {
  return true;
}
