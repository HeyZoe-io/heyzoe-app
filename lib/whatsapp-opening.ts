import type { BusinessKnowledgePack } from "@/lib/business-context";
import { buildDefaultSaleWelcome } from "@/lib/default-welcome";
import { buildWhatsAppOpeningBody, getWhatsAppOpeningPreviewSections } from "@/lib/sales-flow";
import { ZOE_WHATSAPP_MENU_FOOTER } from "@/lib/whatsapp-copy";

/**
 * Opening message as plain body + menu labels (for Meta interactive / Twilio numbered lists).
 */
export function getWhatsAppOpeningBodyAndMenuLabels(k: BusinessKnowledgePack): {
  body: string;
  menuLabels: string[];
} {
  if (k.salesFlowConfig) {
    const sections = getWhatsAppOpeningPreviewSections(
      k.salesFlowConfig,
      k.serviceNamesForOpening.map((name) => ({ name })),
      k.botName,
      k.businessName,
      k.taglineText || k.businessDescription
    );
    const texts: string[] = [];
    let menuLabels: string[] = [];
    for (const s of sections) {
      if (s.kind === "text") texts.push(s.text);
      if (s.kind === "buttons") menuLabels = [...s.labels];
    }
    return { body: texts.join("\n\n"), menuLabels };
  }

  const intro = k.welcomeIntroText?.trim() ?? "";
  const q = k.welcomeQuestionText?.trim() ?? "";
  const opts = (k.welcomeOptionLabels ?? []).map((o) => o.trim()).filter(Boolean);

  if (intro || q || opts.length) {
    const lines: string[] = [];
    if (intro) lines.push(intro);
    if (q) lines.push(q);
    return { body: lines.join("\n\n"), menuLabels: opts };
  }

  const built = buildDefaultSaleWelcome({
    botName: k.botName,
    businessName: k.businessName,
    address: k.addressText,
    services: k.serviceNamesForOpening.map((name) => ({ name })),
    niche: k.niche,
    vibeLabels: k.vibeLabels,
    tagline: k.businessDescription,
    traits: [],
  });
  const bodyLines: string[] = [];
  if (built.intro) bodyLines.push(built.intro);
  if (built.question) bodyLines.push(built.question);
  return { body: bodyLines.join("\n\n"), menuLabels: [...built.options] };
}

/** טקסט הודעת פתיחה לווטסאפ — לפי מסלול המכירה בדשבורד, או טמפלייט */
export function formatWhatsAppOpeningText(k: BusinessKnowledgePack): string {
  if (k.salesFlowConfig) {
    const body = buildWhatsAppOpeningBody(
      k.salesFlowConfig,
      k.serviceNamesForOpening.map((name) => ({ name })),
      k.botName,
      k.businessName,
      k.taglineText || k.businessDescription
    );
    return `${body.trim()}\n\n${ZOE_WHATSAPP_MENU_FOOTER}`;
  }

  const { body, menuLabels } = getWhatsAppOpeningBodyAndMenuLabels(k);
  const core = menuLabels.length ? [body, ...menuLabels].filter(Boolean).join("\n") : body.trim();
  return core ? `${core}\n\n${ZOE_WHATSAPP_MENU_FOOTER}` : ZOE_WHATSAPP_MENU_FOOTER;
}
