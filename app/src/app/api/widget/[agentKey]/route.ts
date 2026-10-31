import { NextResponse } from "next/server";
import { getLocale, pickLocale, translatorFor } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";
import { getDb } from "@/lib/db";
import { corsHeaders, originAllowed, parseWidgetKey, requestOrigin, widgetContext } from "@/lib/widget";
import { normalizeAgentSettings, parseJson } from "@/voice/normalize";

/**
 * Public configuration of an embedded web voice widget (GET /api/widget/<key>?lang=<tags>): look,
 * labels and whether it talks (provider web SDK) or chats (simulated provider). The loader sends no
 * cookies, so it passes the host page's language (its lang attribute, then the browser's) as a
 * comma list; the first one installed and active here is used, else the site's default language.
 * Only answered for an enabled widget on one of the agent's allowed sites.
 */
export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request, { params }: { params: Promise<{ agentKey: string }> }): Promise<Response> {
  const origin = requestOrigin(request);
  const agentId = await parseWidgetKey((await params).agentKey);
  let allowed = false;
  if (agentId) {
    const db = await getDb();
    const row = await db.selectFrom("agents").select("settings").where("id", "=", agentId).executeTakeFirst();
    allowed = row ? originAllowed(origin, normalizeAgentSettings(parseJson(row.settings)).widget.allowedDomains) : false;
  }
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin"), allowed) });
}

export async function GET(request: Request, { params }: { params: Promise<{ agentKey: string }> }): Promise<Response> {
  const ctx = await widgetContext((await params).agentKey, request);
  const headers = corsHeaders(request.headers.get("origin"), ctx.allowed);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status, headers });
  const tags = (new URL(request.url).searchParams.get("lang") ?? "").split(",").slice(0, 4);
  const [picked, settings] = await Promise.all([pickLocale(tags), getSettings()]);
  const locale = picked ?? (await getLocale());
  const t = translatorFor(locale);
  const branding = ctx.workspace.settings.branding;
  const whiteLabel = ctx.entitlements.allowWhiteLabel;
  const widget = ctx.agent.settings.widget;
  return NextResponse.json(
    {
      title: widget.title || t("widget.talk"),
      color: widget.color || (whiteLabel && branding.color) || settings.primary_color || "#a21caf",
      position: widget.position,
      mode: ctx.agent.provider === "simulated" ? "chat" : "voice",
      lang: ctx.agent.language,
      dir: locale.dir,
      name: (whiteLabel && branding.companyName) || ctx.agent.settings.businessName || ctx.workspace.name,
      poweredBy: ctx.entitlements.removeBranding ? "" : t("widget.poweredBy", { name: settings.site_name }),
      labels: {
        start: ctx.agent.provider === "simulated" ? t("widget.startChat") : t("widget.startCall"),
        connecting: t("widget.connecting"),
        listening: t("widget.listening"),
        speaking: t("widget.speaking"),
        chatting: t("widget.chatting"),
        end: t("widget.end"),
        mute: t("widget.mute"),
        unmute: t("widget.unmute"),
        send: t("widget.send"),
        speak: t("widget.speak"),
        type: t("widget.type"),
        ended: t("widget.ended"),
        again: t("widget.again"),
        mic: t("widget.micBlocked"),
        error: t("widget.error"),
        busy: t("widget.busy"),
        unavailable: t("widget.unavailable"),
        close: t("widget.close"),
        notice: ctx.agent.settings.recording ? t("widget.noticeRecorded") : t("widget.notice"),
        you: t("widget.you"),
        agent: t("widget.agent"),
      },
    },
    { headers },
  );
}
