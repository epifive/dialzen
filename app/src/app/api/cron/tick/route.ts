import { NextResponse, type NextRequest } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isValidCronSecret, runTick } from "@/lib/scheduler";

/**
 * Runs one scheduler tick (the background jobs). Call it every minute from cron, the worker or any pinger:
 *   curl -fsS "https://your-site.com/api/cron/tick?key=SECRET"
 *   curl -fsS -H "Authorization: Bearer SECRET" https://your-site.com/api/cron/tick
 * The secret is CRON_SECRET (env) or the one shown in Admin → System.
 * (Vercel Cron sends "Authorization: Bearer $CRON_SECRET" automatically.)
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: NextRequest): Promise<Response> {
  const ip = await clientIp();
  if (!rateLimit(`cron:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const auth = request.headers.get("authorization");
  const key = request.nextUrl.searchParams.get("key") ?? (auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null);
  if (!(await isValidCronSecret(key))) {
    return NextResponse.json({ error: "Invalid or missing key." }, { status: 401 });
  }
  const source = request.headers.get("x-dialzen-worker") === "1" ? "worker" : "cron";
  const summary = await runTick({ budgetMs: 45_000, source });
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
