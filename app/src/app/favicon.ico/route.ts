import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { uploadUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Browsers request /favicon.ico on their own; send them to the configured icon. */
export async function GET(request: Request) {
  const settings = await getSettings().catch(() => null);
  const target = settings?.favicon ? uploadUrl(settings.favicon) : "/icon.svg";
  return NextResponse.redirect(new URL(target, request.url), 302);
}
