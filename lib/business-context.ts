import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildVibeInstructionLines } from "@/lib/vibe-prompt";

export type QuickReplyEntry = { label: string; reply: string };

export type SalesFlowBlockPack = { intro: string; question: string; options: string[] };

export type BusinessKnowledgePack = {
  businessName: string;
  botName: string;
  niche: string;
  businessDescription: string;
  addressText: string;
  arboxLink: string;
  openingMediaUrl: string;
  openingMediaType: "image" | "video" | "";
  servicesShortText: string;
  servicesText: string;
  serviceNamesForOpening: string[];
  faqsText: string;
  ctaText: string;
  ctaLink: string;
  targetAudienceText: string;
  benefitsText: string;
  vibeText: string;
  vibeLabels: string[];
  ageRangeText: string;
  genderText: string;
  scheduleText: string;
  quickReplies: QuickReplyEntry[];
  welcomeIntroText: string;
  welcomeQuestionText: string;
  welcomeOptionLabels: string[];
  salesFlowBlocks: SalesFlowBlockPack[];
};

function truncateText(value: string, max = 280): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}...`;
}

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&#39;": "'",
    "&lt;": "<", "&gt;": ">", "&ndash;": "-", "&mdash;": "-",
  };
  return input
    .replace(/&(nbsp|amp|quot|#39|lt|gt|ndash|mdash);/g, (m) => named[m] ?? m)
    .replace(/&#(\d+);/g, (_, num) => {
      const n = Number(num);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    });
}

function sanitizeText(value: string, max = 350): string {
  return truncateText(
    decodeHtmlEntities(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    max
  );
}

export async function getBusinessKnowledgePack(slug: string): Promise<BusinessKnowledgePack | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: business } = await admin
      .from("businesses")
      .select("id, name, niche, cta_text, cta_link, social_links, bot_name")
      .eq("slug", slug)
      .maybeSingle();
    if (!business) return null;

    const [{ data: services }, { data: faqs }] = await Promise.all([
      admin.from("services").select("name, description, price_text, location_text").eq("business_id", business.id).order("created_at", { ascending: true }),
      admin.from("faqs").select("question, answer").eq("business_id", business.id).order("sort_order", { ascending: true }),
    ]);

    const servicesShortText = services?.length
      ? services
          .slice(0, 3)
          .map(
            (s, i) =>
              `${i + 1}. ${truncateText(String(s.name ?? ""), 46)} — ${truncateText(
                String(s.price_text ?? "מחיר לא צוין"),
                26
              )}`
          )
          .join("\n")
      : "";

    const servicesText = services?.length
      ? services.slice(0, 6).map((s, i) =>
          `${i + 1}. ${truncateText(String(s.name ?? ""), 60)} | מחיר: ${truncateText(String(s.price_text ?? "לא צוין"), 40)} | מיקום: ${s.location_text ?? "לא צוין"} | תיאור: ${truncateText(String(s.description ?? ""), 140)}`
        ).join("\n")
      : "אין שירותים מוגדרים.";

    const faqsText = faqs?.length
      ? faqs.slice(0, 8).map((f, i) =>
          `${i + 1}. ש: ${truncateText(String(f.question ?? ""), 110)} | ת: ${truncateText(String(f.answer ?? ""), 150)}`
        ).join("\n")
      : "אין FAQ מוגדר.";

    const social =
      business.social_links && typeof business.social_links === "object"
        ? (business.social_links as Record<string, unknown>)
        : {};

    const addressText = typeof social.address === "string" ? String(social.address) : "";
    const arboxLink = typeof social.arbox_link === "string" ? String(social.arbox_link) : "";
    const openingMediaUrl =
      typeof social.opening_media_url === "string" ? String(social.opening_media_url) : "";
    const openingMediaType =
      social.opening_media_type === "image" || social.opening_media_type === "video"
        ? (social.opening_media_type as "image" | "video")
        : "";

    const rawQR = Array.isArray(social.quick_replies) ? social.quick_replies : [];
    const quickReplies: QuickReplyEntry[] = rawQR
      .map((r: unknown) => {
        if (typeof r === "string") return { label: r, reply: "" };
        if (r && typeof r === "object") {
          const rr = r as Record<string, unknown>;
          return { label: String(rr.label ?? ""), reply: String(rr.reply ?? "") };
        }
        return null;
      })
      .filter((r): r is QuickReplyEntry => r !== null && r.label.length > 0);

    const tagline = typeof social.tagline === "string" ? social.tagline.trim() : "";
    const fact1 = typeof social.fact1 === "string" ? social.fact1.trim() : "";
    const fact2 = typeof social.fact2 === "string" ? social.fact2.trim() : "";
    const fact3 = typeof social.fact3 === "string" ? social.fact3.trim() : "";
    const traitsList = Array.isArray(social.traits)
      ? social.traits.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [fact1, fact2, fact3].filter(Boolean);
    const fromTraits = traitsList.join(" • ");
    const legacyDesc = String(social.business_description ?? "").trim();
    const businessDescriptionRaw =
      [tagline, fromTraits].filter(Boolean).join(" • ") || legacyDesc;

    const vibeLabels = Array.isArray(social.vibe) ? (social.vibe as string[]).map(String) : [];
    const wo = Array.isArray(social.welcome_options) ? social.welcome_options.map((x) => String(x ?? "").trim()) : [];
    const welcomeOptionLabels = wo.filter(Boolean);

    const rawBlocks = Array.isArray(social.sales_flow_blocks) ? social.sales_flow_blocks : [];
    const salesFlowBlocks: SalesFlowBlockPack[] = rawBlocks
      .map((b: unknown) => {
        if (!b || typeof b !== "object") return null;
        const o = b as Record<string, unknown>;
        const opts = Array.isArray(o.options) ? o.options.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
        return {
          intro: typeof o.intro === "string" ? o.intro.trim() : "",
          question: typeof o.question === "string" ? o.question.trim() : "",
          options: opts,
        };
      })
      .filter((x): x is SalesFlowBlockPack =>
        x !== null && Boolean(x.intro || x.question || x.options.length > 0)
      );

    const serviceNamesForOpening = (services ?? [])
      .map((s) => String(s.name ?? "").trim())
      .filter(Boolean);

    return {
      businessName: String(business.name ?? slug),
      botName: String(business.bot_name ?? "זואי").trim() || "זואי",
      niche: String(business.niche ?? ""),
      businessDescription: sanitizeText(businessDescriptionRaw, 350),
      addressText,
      arboxLink,
      openingMediaUrl,
      openingMediaType,
      servicesShortText,
      servicesText,
      serviceNamesForOpening,
      faqsText,
      ctaText: String(business.cta_text ?? ""),
      ctaLink: String(business.cta_link ?? ""),
      targetAudienceText: Array.isArray(social.target_audience) ? social.target_audience.join(", ") : "",
      benefitsText: Array.isArray(social.benefits) ? social.benefits.join(", ") : "",
      vibeText: vibeLabels.join(", "),
      vibeLabels,
      ageRangeText: typeof social.age_range === "string" ? social.age_range : "",
      genderText: social.gender === "זכר" || social.gender === "נקבה" || social.gender === "הכול" ? social.gender as string : "",
      scheduleText: typeof social.schedule_text === "string" ? social.schedule_text : "",
      quickReplies,
      welcomeIntroText: typeof social.welcome_intro === "string" ? social.welcome_intro : "",
      welcomeQuestionText: typeof social.welcome_question === "string" ? social.welcome_question : "",
      welcomeOptionLabels,
      salesFlowBlocks,
    };
  } catch (e) {
    console.warn("[business-context] getBusinessKnowledgePack failed:", e);
    return null;
  }
}

function formatSalesFlowForPrompt(blocks: SalesFlowBlockPack[]): string {
  if (!blocks.length) return "אין שלבים נוספים אחרי הודעת הפתיחה.";
  return blocks
    .map((b, i) => {
      const opts = b.options.map((o, j) => `  ${j + 1}. ${o}`).join("\n");
      return `שלב ${i + 2} (אחרי תשובה מתאימה מהלקוח):\nטקסט לפני שאלה: ${b.intro || "(ריק)"}\nשאלה: ${b.question || "(ריק)"}\nכפתורים:\n${opts || "  (אין)"}`;
    })
    .join("\n\n");
}

export function buildSystemPrompt(knowledge: BusinessKnowledgePack | null, slug: string, channel: "web" | "whatsapp" = "web"): string {
  const isWhatsApp = channel === "whatsapp";
  const vibeDetail = buildVibeInstructionLines(knowledge?.vibeLabels ?? []);
  const channelNote = isWhatsApp
    ? `
- ערוץ: WhatsApp — תשובות קצרות במיוחד (משפט אחד עד שניים), ללא Markdown, ללא כוכביות.
- כשמתאים, הציעי בחירות כמספרים (1,2,3…) או כפי שמופיע בממשק.
- אם יש כפתורי תשובה מהירה (quick replies) בדשבורד — אפשר להפנות אליהם אחרי מסלול המכירה.`
    : "";

  const bot = knowledge?.botName?.trim() || "זואי";
  const base = `את ${bot}, נציגת השירות של העסק.
שם העסק: ${knowledge?.businessName ?? slug}
שם שמוצג ללקוחות: ${bot}

סגנון דיבור שנבחר (תגיות): ${knowledge?.vibeText || "חם, מקצועי וקצר"}
הנחיות סגנון מפורטות — יש ליישם בכל תשובה, כולל הודעת פתיחה עתידית או המשך שיחה:
${vibeDetail}

כללים:
- עברית בלבד.
- תשובה קצרה: 1-2 משפטים, אלא אם ביקשו פירוט.
- בלי Markdown, בלי JSON.
- אם נשאל על הרשמה/תשלום: לכלול CTA אם קיים.${channelNote}

ידע עסקי:
נישה: ${knowledge?.niche ?? ""}
תיאור עסק: ${knowledge?.businessDescription ?? "לא הוגדר"}
שירותים:
${knowledge?.servicesText ?? "לא הוגדר"}
FAQ:
${knowledge?.faqsText ?? "לא הוגדר"}
CTA: ${knowledge?.ctaText ?? "לא הוגדר"} | ${knowledge?.ctaLink ?? "לא הוגדר"}
קהל יעד: ${knowledge?.targetAudienceText ?? "לא הוגדר"} | גיל: ${knowledge?.ageRangeText ?? "לא הוגדר"} | מגדר: ${knowledge?.genderText ?? "לא הוגדר"}
יתרונות: ${knowledge?.benefitsText ?? "לא הוגדר"}
שעות פעילות: ${knowledge?.scheduleText ?? "לא הוגדר"}`;

  const openingIntro = knowledge?.welcomeIntroText?.trim() ?? "";
  const openingQ = knowledge?.welcomeQuestionText?.trim() ?? "";
  const openingOpts = (knowledge?.welcomeOptionLabels ?? []).join(" | ");
  const saleFlowExtra = `
מסלול מכירה מהדשבורד:
- פתיחה (לעיונך / אם צריך לשחזר בצ'אט): ${openingIntro || "ברירת מחדל לפי שם בוט, עסק, כתובת"} | שאלה: ${openingQ || "—"} | כפתורים: ${openingOpts || "—"}
- שלבים נוספים אחרי תשובה לפתיחה:
${formatSalesFlowForPrompt(knowledge?.salesFlowBlocks ?? [])}
- נסחי בהתאם לסגנון הדיבור שנבחר למעלה.`;

  if (!isWhatsApp) {
    return `${base}
${saleFlowExtra}`;
  }

  return `${base}

הוראות ספציפיות לזרימת וואטסאפ (מסלול מכירה מהדשבורד):
- הודעת הפתיחה נשלחת אוטומטית מהמערכת לפי ההגדרות — אל תחזירי אותה מחדש בתשובתך הראשונה אלא אם התבקשת במפורש.
${saleFlowExtra}
- אם יש לינק Arbox/שעות: ${knowledge?.arboxLink ? "הציעי אותו כשמתאים להרשמה." : "אין לינק — אל תמציאי."}
- לעולם אל תשתמשי ב-Markdown או ברשימות תבליטים; בוואטסאפ הטקסט חייב להיות פשוט וברור.
`;
}
