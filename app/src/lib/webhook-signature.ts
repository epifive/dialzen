import crypto from "node:crypto";

/**
 * Signature of every webhook Dialzen sends (notification channels, REST API webhooks, webhook
 * tools and their test):
 *
 *   X-Dialzen-Timestamp: <unix seconds>
 *   X-Dialzen-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *
 * Verify: compute the HMAC over the timestamp header, a dot and the raw body with your secret,
 * compare it with the signature in constant time, and reject timestamps older than 5 minutes
 * (replays).
 */

export function signPayload(body: string, secret: string, timestampSec: number): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex")}`;
}

/** The timestamp header, plus the signature when there is a secret. */
export function signatureHeaders(body: string, secret: string, nowMs: number = Date.now()): Record<string, string> {
  const t = Math.floor(nowMs / 1000);
  return { "X-Dialzen-Timestamp": String(t), ...(secret ? { "X-Dialzen-Signature": signPayload(body, secret, t) } : {}) };
}
