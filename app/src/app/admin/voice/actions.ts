"use server";

import { revalidatePath } from "next/cache";
import "@/lib/voice";
import type { FormState } from "@/app/actions/types";
import { guardAdmin } from "@/lib/admin";
import { getProvider, platformKeys, simulatedAllowed } from "@/lib/providers";
import { writeRaw } from "@/lib/scheduler";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { retryCleanupLeftovers } from "@/lib/voice/cleanup";
import { reconcileRecentCalls } from "@/lib/voice/reconcile";
import { isProvider } from "@/voice/normalize";
import type { ProviderContext } from "@/voice/types";

/** Admin → Voice providers: connection tests, voice lists and a manual reconciliation run. */

async function adminContext(id: string): Promise<{ ctx: ProviderContext; error?: undefined } | { ctx?: undefined; error: string }> {
  if (!isProvider(id) || !getProvider(id)) return { error: "Unknown provider." };
  const settings = await getSettings();
  if (id === "simulated" && !simulatedAllowed(settings)) return { error: "The simulated provider is turned off (Settings → Voice providers → Testing)." };
  const keys = platformKeys(settings, id);
  if (!keys.apiKey) return { error: "Add the API key first (Settings → Voice providers)." };
  return {
    ctx: {
      provider: id,
      keys,
      keySource: "platform",
      fetch,
      now: Date.now,
      baseUrl: absoluteUrl(settings).replace(/\/+$/, ""),
      apiBase: process.env[`DIALZEN_TEST_${id.toUpperCase()}_API`]?.trim() ?? "",
      timeoutMs: 12_000,
    },
  };
}

export async function testProviderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardAdmin({ allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  const id = String(formData.get("provider") ?? "");
  const resolved = await adminContext(id);
  if (!resolved.ctx) return { error: resolved.error };
  const result = await getProvider(id)!.testConnection(resolved.ctx);
  if (!result.ok) return { error: `${result.error.message} (${result.error.kind})` };
  return { success: `Connected: ${result.account}.${result.detail ? ` ${result.detail}` : ""}` };
}

export async function listVoicesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardAdmin({ allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  const id = String(formData.get("provider") ?? "");
  const lang = String(formData.get("lang") ?? "").slice(0, 10);
  const resolved = await adminContext(id);
  if (!resolved.ctx) return { error: resolved.error };
  try {
    const voices = await getProvider(id)!.listVoices(resolved.ctx, lang || undefined);
    if (!voices.length) return { success: `No voices${lang ? ` for "${lang}"` : ""}.` };
    const names = voices.slice(0, 10).map((v) => `${v.name}${v.gender ? ` (${v.gender})` : ""}`);
    return { success: `${voices.length} voices${lang ? ` for "${lang}"` : ""}: ${names.join(", ")}${voices.length > 10 ? ", …" : ""}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not list voices." };
  }
}

export async function reconcileNowAction(): Promise<FormState> {
  const guard = await guardAdmin({ allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  const summary = await reconcileRecentCalls({ hours: 48, deadline: Date.now() + 25_000 });
  await writeRaw("voice_reconcile_last", JSON.stringify({ at: new Date().toISOString(), ...summary }));
  revalidatePath("/admin/voice");
  return { success: `Checked ${summary.checked} calls: ${summary.completed} completed from the provider's record, ${summary.drift} corrected, ${summary.failed} stuck calls closed${summary.errors ? `, ${summary.errors} errors` : ""}.` };
}

/** Retries removing what deleted workspaces left at the providers (site keys); "drop" also forgets leftovers in workspaces' own accounts. */
export async function retryCleanupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const res = await retryCleanupLeftovers({ dropByo: formData.get("drop_byo") === "1" });
  revalidatePath("/admin/voice");
  return res.left ? { error: `${res.removed} removed, ${res.left} still left (see the errors below).` } : { success: `${res.removed} removed. Nothing is left.` };
}
