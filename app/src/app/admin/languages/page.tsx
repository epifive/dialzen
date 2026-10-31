import Link from "next/link";
import { Card, PageHeader, Table, Td, Th } from "@/components/admin/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { getTranslationEntries } from "@/lib/i18n/catalog";
import { getSettings } from "@/lib/settings";
import { AddLanguageForm, DefaultLanguageForm } from "./language-forms";

export const metadata = { title: "Languages" };

export default async function AdminLanguagesPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const params = await searchParams;
  const db = await getDb();
  const [languages, counts, entries, settings] = await Promise.all([
    db.selectFrom("languages").selectAll().orderBy("sort_order").orderBy("name").execute(),
    db
      .selectFrom("translations")
      .select(["lang", (eb) => eb.fn.countAll<number>().as("n")])
      .groupBy("lang")
      .execute(),
    getTranslationEntries(),
    getSettings(),
  ]);
  const total = entries.length;
  const translated = new Map(counts.map((c) => [c.lang, Number(c.n)]));

  return (
    <>
      <PageHeader
        title="Languages"
        description="Translate the website and dashboard. Visitors pick a language from the switcher in the header."
      />
      {params.deleted ? <Alert tone="success" className="mb-4">Language deleted.</Alert> : null}

      <Card padded={false}>
        <Table minWidth={680}>
          <thead>
            <tr>
              <Th>Language</Th>
              <Th>Direction</Th>
              <Th>Translated</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {languages.map((l) => {
              const done = l.code === "en" ? total : Math.min(total, translated.get(l.code) ?? 0);
              const percent = total ? Math.round((done / total) * 100) : 0;
              return (
                <tr key={l.code}>
                  <Td>
                    <p className="font-medium">
                      {l.name} <span className="font-normal text-muted">– {l.native_name}</span>
                    </p>
                    <p className="font-mono text-xs text-muted">{l.code}</p>
                  </Td>
                  <Td className="text-muted">{l.direction === "rtl" ? "Right to left" : "Left to right"}</Td>
                  <Td>
                    {l.code === "en" ? (
                      <span className="text-sm text-muted">Source language</span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-line" aria-hidden>
                          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                        </div>
                        <span className="text-sm tabular-nums">{percent}%</span>
                      </div>
                    )}
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={l.is_active ? "success" : "neutral"}>{l.is_active ? "Active" : "Inactive"}</Badge>
                      {settings.default_language === l.code ? <Badge tone="primary">Default</Badge> : null}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <Link href={`/admin/languages/${l.code}`} className="text-sm font-medium text-primary hover:underline">
                      {l.code === "en" ? "Edit wording" : "Translate"}
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Add a language">
          <AddLanguageForm existing={languages.map((l) => l.code)} />
        </Card>
        <div className="space-y-6">
          <Card title="Default language">
            <p className="mb-4 text-sm text-muted">Shown to visitors who haven&apos;t chosen a language yet.</p>
            <DefaultLanguageForm
              languages={languages.filter((l) => l.is_active).map((l) => ({ code: l.code, name: `${l.name} – ${l.native_name}` }))}
              current={settings.default_language}
            />
          </Card>
          <Card title="How translation works">
            <ul className="list-disc space-y-1.5 ps-5 text-sm text-muted">
              <li>Anything left empty falls back to the English text, so you can translate step by step.</li>
              <li>Download a template, translate it with any tool or translator, and import it back.</li>
              <li>The switcher appears in the header once two or more languages are active.</li>
              <li>Right-to-left languages flip the whole layout automatically.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
