import { getCurrentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getTranslationEntries } from "@/lib/i18n/catalog";

export const dynamic = "force-dynamic";

/**
 * Download a language as JSON. ?template=1 returns every key, with the English
 * text for anything not translated yet, ready to translate offline and import.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return new Response("Not found", { status: 404 });
  const { code } = await params;
  const db = await getDb();
  const language = await db.selectFrom("languages").selectAll().where("code", "=", code).executeTakeFirst();
  if (!language) return new Response("Not found", { status: 404 });

  const template = new URL(request.url).searchParams.get("template") === "1";
  const rows = await db.selectFrom("translations").select(["key", "value"]).where("lang", "=", code).execute();
  const saved = new Map(rows.map((r) => [r.key, r.value]));
  const translations: Record<string, string> = {};
  for (const entry of await getTranslationEntries()) {
    const value = saved.get(entry.key);
    if (value) translations[entry.key] = value;
    else if (template) translations[entry.key] = entry.source;
  }

  const body = JSON.stringify(
    {
      language: { code: language.code, name: language.name, native_name: language.native_name, direction: language.direction },
      translations,
    },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dialzen-${code}${template ? "-template" : ""}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
