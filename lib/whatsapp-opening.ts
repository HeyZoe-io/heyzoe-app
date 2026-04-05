import type { BusinessKnowledgePack } from "@/lib/business-context";
import { buildDefaultSaleWelcome } from "@/lib/default-welcome";

/** טקסט הודעת פתיחה לווטסאפ — לפי ההגדרות בדשבורד, או טמפלייט */
export function formatWhatsAppOpeningText(k: BusinessKnowledgePack): string {
  const intro = k.welcomeIntroText?.trim() ?? "";
  const q = k.welcomeQuestionText?.trim() ?? "";
  const opts = (k.welcomeOptionLabels ?? []).map((o) => o.trim()).filter(Boolean);

  if (intro || q || opts.length) {
    const lines: string[] = [];
    if (intro) lines.push(intro);
    if (q) lines.push(q);
    opts.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
    lines.push("\nניתן לענות במספר או לפי שם הכפתור.");
    return lines.join("\n");
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
  const lines: string[] = [];
  if (built.intro) lines.push(built.intro);
  if (built.question) lines.push(built.question);
  built.options.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
  lines.push("\nניתן לענות במספר או לפי שם הכפתור.");
  return lines.join("\n");
}
