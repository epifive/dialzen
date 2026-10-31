import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { Card, EmptyState, PageHeader, Pagination } from "@/components/admin/ui";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { getTranslationEntries, TRANSLATION_GROUPS, type TranslationGroup } from "@/lib/i18n/catalog";
import { cn } from "@/lib/utils";
import { DeleteLanguageForm, ImportForm, LanguageSettingsForm, TranslationsForm } from "../language-forms";

export const metadata = { title: "Translate" };

const PER_PAGE = 40;

export default async function TranslateLanguagePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ group?: string; q?: string; missing?: string; page?: string; created?: string }>;
}) {
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const db = await getDb();
  const language = await db.selectFrom("languages").selectAll().where("code", "=", code).executeTakeFirst();
  if (!language) notFound();

  const group: TranslationGroup = TRANSLATION_GROUPS.some((g) => g.id === query.group) ? (query.group as TranslationGroup) : "interface";
  const q = (query.q ?? "").trim().slice(0, 100).toLowerCase();
  const missingOnly = query.missing === "1";
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);

  const [entries, saved] = await Promise.all([
    getTranslationEntries(),
    db.selectFrom("translations").select(["key", "value"]).where("lang", "=", code).execute(),
  ]);
  const values = new Map(saved.map((r) => [r.key, r.value]));
  const groupStats = TRANSLATION_GROUPS.map((g) => {
    const list = entries.filter((e) => e.group === g.id);
    return { ...g, total: list.length, done: list.filter((e) => values.has(e.key)).length };
  });

  const filtered = entries.filter(
    (e) =>
      e.group === group &&
      (!missingOnly || !values.has(e.key)) &&
      (!q ||
        e.key.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        (values.get(e.key) ?? "").toLowerCase().includes(q) ||
        (e.context ?? "").toLowerCase().includes(q)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const rows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((e) => ({
    key: e.key,
    source: e.source,
    context: e.context,
    multiline: e.multiline,
    value: values.get(e.key) ?? "",
  }));

  const href = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { group, q: q || undefined, missing: missingOnly ? "1" : undefined, ...changes };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    return `/admin/languages/${code}?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title={`${language.name} – ${language.native_name}`}
        description={
          <Link href="/admin/languages" className="text-primary hover:underline">
            Back to languages
          </Link>
        }
        actions={
          <>
            <a href={`/admin/languages/${code}/export?template=1`} download className={buttonClass("outline", "md")}>
              Download template
            </a>
            <a href={`/admin/languages/${code}/export`} download className={buttonClass("outline", "md")}>
              Export
            </a>
          </>
        }
      />
      {query.created ? (
        <Alert tone="success" className="mb-4">
          Language added. Translate the texts below, then switch it to active.
        </Alert>
      ) : null}
      {code === "en" ? (
        <Alert tone="info" className="mb-4">
          English is the built-in source language. Anything you enter here replaces the default English wording.
        </Alert>
      ) : null}

      <nav aria-label="Text groups" className="mb-4 flex flex-wrap gap-2">
        {groupStats.map((g) => (
          <Link
            key={g.id}
            href={href({ group: g.id, page: undefined })}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              g.id === group ? "border-primary bg-primary text-white" : "border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {g.label}{" "}
            <span className={cn("tabular-nums", g.id === group ? "text-white/80" : "text-muted")}>
              {g.done}/{g.total}
            </span>
          </Link>
        ))}
      </nav>

      <Card padded={false}>
        <form className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3" action={`/admin/languages/${code}`}>
          <input type="hidden" name="group" value={group} />
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search text or key"
              aria-label="Search text or key"
              className="h-10 w-full rounded-lg border border-line bg-paper pe-3 ps-9 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="missing" value="1" defaultChecked={missingOnly} className="size-4 accent-[var(--primary)]" />
            Untranslated only
          </label>
          <button type="submit" className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-primary-line">
            Filter
          </button>
        </form>
        <p className="px-5 pt-3 text-xs text-muted">{TRANSLATION_GROUPS.find((g) => g.id === group)?.description}</p>
        {rows.length ? (
          <TranslationsForm lang={code} rtl={language.direction === "rtl"} rows={rows} />
        ) : (
          <EmptyState title={missingOnly ? "Everything here is translated" : "No matching texts"}>
            {missingOnly ? "Nice work. Pick another group above." : "Try a different search."}
          </EmptyState>
        )}
        <Pagination page={Math.min(page, pages)} pages={pages} href={(n) => href({ page: String(n) })} />
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Language settings">
          <LanguageSettingsForm
            language={{
              code: language.code,
              name: language.name,
              nativeName: language.native_name,
              direction: language.direction,
              isActive: language.is_active === 1,
              sortOrder: language.sort_order,
            }}
          />
        </Card>
        <div className="space-y-6">
          <Card title="Import translations">
            <p className="mb-4 text-sm text-muted">
              Upload a JSON file of <code className="font-mono text-xs">{"{ \"key\": \"text\" }"}</code> pairs, or a file exported from
              another site. Imported texts replace existing ones; keys that aren&apos;t in the file are left as they are.
            </p>
            <ImportForm lang={code} />
          </Card>
          {code !== "en" ? (
            <Card title="Delete language">
              <p className="mb-4 text-sm text-muted">Removes the language and all of its translations. This can&apos;t be undone.</p>
              <DeleteLanguageForm code={code} name={language.name} />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
