import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/ui";
import { getSettings, SECRET_SETTINGS } from "@/lib/settings";
import { absoluteUrl, uploadUrl } from "@/lib/site";
import { cn } from "@/lib/utils";
import { getSection, SETTING_SECTIONS } from "../sections";
import { MediaStorageTest } from "../media-storage-test";
import { SettingsForm } from "./settings-form";

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const section = getSection((await params).section);
  return { title: section ? `${section.title} settings` : "Settings" };
}

export default async function SettingsPage({ params }: { params: Promise<{ section: string }> }) {
  const section = getSection((await params).section);
  if (!section) notFound();
  const settings = await getSettings();

  // Secrets are never sent to the browser; the form shows whether one is saved.
  const values: Record<string, string | number | boolean> = {};
  const secretsSet: Record<string, boolean> = {};
  for (const field of section.fields) {
    const value = settings[field.key];
    if (SECRET_SETTINGS.includes(field.key)) {
      secretsSet[field.key] = Boolean(value);
      values[field.key] = "";
    } else if (field.type === "image") {
      values[field.key] = uploadUrl(String(value));
    } else {
      values[field.key] = value;
    }
  }
  const siteUrl = absoluteUrl(settings, "/").replace(/\/+$/, "");

  return (
    <>
      <PageHeader title="Settings" description="Configure your site. Changes apply immediately." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Settings sections">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {SETTING_SECTIONS.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/admin/settings/${s.slug}`}
                  aria-current={s.slug === section.slug ? "page" : undefined}
                  className={cn(
                    "block rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap",
                    s.slug === section.slug ? "bg-surface text-primary ring-1 ring-line" : "text-muted hover:text-ink",
                  )}
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <SettingsForm
            key={section.slug}
            section={{
              ...section,
              fields: section.fields.map((f) => ({ ...f, hint: f.hint?.replaceAll("{site_url}", siteUrl) })),
            }}
            values={values}
            secretsSet={secretsSet}
          />
          {section.slug === "media" ? <MediaStorageTest /> : null}
        </div>
      </div>
    </>
  );
}
