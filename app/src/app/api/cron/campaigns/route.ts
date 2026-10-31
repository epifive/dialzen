import { NextResponse, type NextRequest } from "next/server";
import { runCampaignEngine } from "@/lib/campaigns/engine";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isValidCronSecret } from "@/lib/scheduler";

/**
 * Runs only the campaign dialer, without the scheduler's tick lock, for a faster dialing pace
 * than the one-minute tick (e.g. a cron every 15 seconds next to /api/cron/tick). The engine is
 * lease-based, so this may overlap with ticks and with itself safely.
 *   curl -fsS -H "Authorization: Bearer SECRET" https://your-site.com/api/cron/campaigns
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest): Promise<Response> {
  const ip = await clientIp();
  if (!rateLimit(`cron-campaigns:${ip}`, 300, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const auth = request.headers.get("authorization");
  const key = request.nextUrl.searchParams.get("key") ?? (auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null);
  if (!(await isValidCronSecret(key))) return NextResponse.json({ error: "Invalid or missing key." }, { status: 401 });
  const started = Date.now();
  const result = await runCampaignEngine({ deadline: started + 25_000 });
  return NextResponse.json({ ...result, durationMs: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
