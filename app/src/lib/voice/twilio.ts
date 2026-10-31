import { ProviderError } from "@/voice/types";
import { asArr, asObj, asStr, errorKind, errorMessage } from "./http";

/**
 * The one Twilio call we make: checking that an account owns a number before it is imported into
 * ElevenLabs or Retell (so a typo doesn't create a dead number). Pure; fetch is injected.
 */

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

export const TWILIO_SID_RE = /^AC[0-9a-fA-F]{32}$/;

/** The Twilio phone number sid of `e164` in the account; throws ProviderError (auth / not_found / network). */
export async function verifyTwilioNumber(fetchImpl: typeof fetch, creds: TwilioCredentials, e164: string, apiBase = ""): Promise<{ sid: string; friendlyName: string }> {
  if (!TWILIO_SID_RE.test(creds.accountSid) || !creds.authToken.trim()) throw new ProviderError("validation", "Enter the Twilio Account SID (AC…) and auth token.");
  const base = (apiBase || process.env.DIALZEN_TEST_TWILIO_API?.trim() || "https://api.twilio.com").replace(/\/+$/, "");
  const url = `${base}/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(e164)}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new ProviderError("network", "Could not reach Twilio.");
  }
  const text = await res.text().catch(() => "");
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep text
  }
  if (!res.ok) throw new ProviderError(errorKind(res.status), res.status === 401 ? "Twilio rejected the Account SID or auth token." : `Twilio: ${errorMessage(body, `HTTP ${res.status}`)}`, { status: res.status });
  const match = asArr(asObj(body).incoming_phone_numbers)
    .map(asObj)
    .find((n) => asStr(n.phone_number) === e164);
  if (!match) throw new ProviderError("not_found", `The Twilio account doesn't own ${e164}.`);
  return { sid: asStr(match.sid), friendlyName: asStr(match.friendly_name) };
}
