import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { ContactForm } from "@/components/site/contact-form";
import { getT } from "@/lib/i18n/server";
import { getSiteContext } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("contact.metaTitle"),
    description: t("contact.metaDescription"),
    alternates: { canonical: "/contact" },
  };
}

export default async function ContactPage() {
  const [{ settings, user }, t] = await Promise.all([getSiteContext(), getT()]);
  if (!settings.contact_enabled) notFound();
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
      <div>
        <h1 className="text-4xl font-bold">{t("contact.title")}</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">{t("contact.text")}</p>
        <p className="mt-8 flex items-center gap-3 text-sm">
          <Mail className="size-5 text-primary" aria-hidden />
          <a href={`mailto:${settings.site_email}`} className="font-medium hover:text-primary">
            {settings.site_email}
          </a>
        </p>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <ContactForm defaultName={user?.name} defaultEmail={user?.email} />
      </div>
    </div>
  );
}
