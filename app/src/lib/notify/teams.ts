import "server-only";
import type { NotifyPayload, NotifyConfigByType } from "@/voice/types";
import { describeNotification, isProblem, type SendContext, type SendResult } from "./format";
import { deliver } from "./webhook";

/** Power Automate "Workflows" webhooks (the replacement for Office 365 connectors) need an Adaptive Card. */
function isWorkflowUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".logic.azure.com") || host.endsWith(".powerplatform.com") || host.endsWith(".powerautomate.com");
  } catch {
    return false;
  }
}

export async function sendTeams(config: NotifyConfigByType["teams"], payload: NotifyPayload, ctx: SendContext): Promise<SendResult> {
  if (!config.webhookUrl) return { ok: false, error: "No Teams webhook URL configured" };
  const t = describeNotification(payload, ctx.siteName);
  const color = payload.event === "quota_warning" ? "Warning" : isProblem(payload.event) ? "Attention" : "Accent";
  const body = isWorkflowUrl(config.webhookUrl)
    ? {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              type: "AdaptiveCard",
              version: "1.4",
              body: [
                { type: "TextBlock", text: t.title, weight: "Bolder", size: "Medium", wrap: true, color },
                { type: "TextBlock", text: t.summary, wrap: true },
                { type: "FactSet", facts: t.facts.map(([title, value]) => ({ title, value })) },
              ],
              actions: [{ type: "Action.OpenUrl", title: t.linkLabel, url: payload.url }],
            },
          },
        ],
      }
    : {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        themeColor: t.color.slice(1),
        summary: t.title,
        title: t.title,
        text: t.summary,
        sections: [{ facts: t.facts.map(([name, value]) => ({ name, value })) }],
        potentialAction: [{ "@type": "OpenUri", name: t.linkLabel, targets: [{ os: "default", uri: payload.url }] }],
      };
  return deliver(config.webhookUrl, JSON.stringify(body), ctx);
}
