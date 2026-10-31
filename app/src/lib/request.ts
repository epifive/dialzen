import "server-only";
import { headers } from "next/headers";
import { getSettings } from "./settings";

/** Public base URL of the site: the configured Site URL, or the current request's origin. */
export async function baseUrl(): Promise<string> {
  const settings = await getSettings();
  if (settings.site_url) return settings.site_url.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = (h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}
