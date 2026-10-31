import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BillingShowcase } from "@/components/site/landing/billing-showcase";
import { BuilderShowcase } from "@/components/site/landing/builder-showcase";
import { CallShowcase } from "@/components/site/landing/call-showcase";
import { CampaignShowcase } from "@/components/site/landing/campaign-showcase";
import { Compliance } from "@/components/site/landing/compliance";
import { Faq } from "@/components/site/landing/faq";
import { Features } from "@/components/site/landing/features";
import { FinalCta } from "@/components/site/landing/final-cta";
import { Hero, ProofStrip } from "@/components/site/landing/hero";
import { HowItWorks } from "@/components/site/landing/how-it-works";
import { Integrations } from "@/components/site/landing/integrations";
import { LandingStyles } from "@/components/site/landing/mock-kit";
import { PricingTeaser, type TeaserPlan } from "@/components/site/landing/pricing-teaser";
import { UseCases } from "@/components/site/landing/use-cases";
import { PostCard } from "@/components/site/post-card";
import { getLatestPosts } from "@/lib/blog";
import { getT, localSetting } from "@/lib/i18n/server";
import { isDemoMode } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getActivePlans, planCardLimits } from "@/lib/plans";
import { getSiteContext } from "@/lib/site";

/**
 * Home page: hero with a live call, how it works, the eight agent templates, features, four
 * product showcases (builder, call log, campaigns, billing), integrations, compliance, pricing,
 * FAQ and the latest blog posts. Every illustration is plain HTML/SVG with example data.
 */
export default async function HomePage() {
  const { settings, user, blogVisible, locale } = await getSiteContext();
  const t = await getT();
  const [heroTitle, heroSubtitle, posts, plans] = await Promise.all([
    localSetting(settings, "home_hero_title"),
    localSetting(settings, "home_hero_subtitle"),
    blogVisible ? getLatestPosts(3) : Promise.resolve([]),
    getActivePlans(),
  ]);
  // On the live demo, the seeded "Front desk" agent answers through the website widget (simulated, text mode).
  const demoWidgetKey = isDemoMode() ? await showcaseWidgetKey() : null;

  const signedIn = Boolean(user);
  const lc = locale.code;
  const site = settings.site_name;
  const teaserPlans: TeaserPlan[] = plans.map((p) => {
    const l = planCardLimits(p);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      priceMonthly: p.price_monthly,
      isFree: p.is_free === 1,
      isFeatured: p.is_featured === 1,
      maxAgents: l.maxAgents,
      maxNumbers: l.maxNumbers,
      includedMinutes: l.includedMinutesMonthly,
      maxMembers: l.maxMembers,
      allowCampaigns: l.allowCampaigns,
      allowApi: l.allowApi,
      allowByoKeys: l.allowByoKeys,
      allowWhiteLabel: l.allowWhiteLabel,
    };
  });

  return (
    <>
      <LandingStyles />
      {demoWidgetKey ? <script async src="/dz-widget.js" data-agent={demoWidgetKey} /> : null}
      <Hero t={t} title={heroTitle} subtitle={heroSubtitle} signedIn={signedIn} locale={lc} />
      {settings.show_stats_on_home ? <ProofStrip t={t} /> : null}
      <HowItWorks t={t} locale={lc} />
      <UseCases t={t} />
      <Features t={t} />
      <BuilderShowcase t={t} />
      <CallShowcase t={t} locale={lc} />
      <CampaignShowcase t={t} locale={lc} />
      <Compliance t={t} locale={lc} />
      <BillingShowcase t={t} locale={lc} />
      <Integrations t={t} site={site} />
      <PricingTeaser t={t} plans={teaserPlans} currency={settings.currency || "USD"} locale={lc} />
      <Faq t={t} site={site} contact={settings.contact_enabled} />

      {posts.length ? (
        <section aria-labelledby="posts-title" className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="posts-title" className="text-3xl font-bold tracking-tight">
              {t("home.latestPosts")}
            </h2>
            <Link href="/blog" className="group inline-flex items-center gap-1.5 font-semibold text-primary-text hover:underline">
              {t("home.allPosts")}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden />
            </Link>
          </div>
          <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <li key={post.id}>
                <PostCard post={post} readMore={t("blog.readMore")} locale={lc} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FinalCta t={t} signedIn={signedIn} />
    </>
  );
}

async function showcaseWidgetKey(): Promise<string | null> {
  try {
    const db = await getDb();
    const row = await db.selectFrom("settings").select("value").where("key", "=", "showcase_widget_agent_key").executeTakeFirst();
    return row?.value || null;
  } catch {
    return null;
  }
}
