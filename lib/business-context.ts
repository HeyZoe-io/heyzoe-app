import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildVibeInstructionLines } from "@/lib/vibe-prompt";
import {
  type SalesFlowConfig,
  formatSalesFlowForPrompt,
  parseSalesFlowFromSocial,
} from "@/lib/sales-flow";

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
  followupAfterRegistration: string;
  followupAfterHourNoRegistration: string;
  followupDayAfterTrial: string;
  membershipsAndCardsText: string;
  salesFlowConfig: SalesFlowConfig | null;
  salesFlowPromptSection: string;
};

function formatMembershipsAndCardsBlock(
  social: Record<string, unknown>,
  servicesList: { name: string; service_slug: string | null }[]
): string {
  const slugToName = new Map<string, string>();
  for (const s of servicesList) {
    const name = String(s.name ?? "").trim();
    if (!name) continue;
    const slug = String(s.service_slug ?? "").trim() || name;
    slugToName.set(slug, name);
  }

  const excludedLine = (slugs: string[]): string => {
    if (!slugs.length) return "כל אימוני הניסיון כלולים";
    const labels = slugs.map((x) => slugToName.get(x) || x).filter(Boolean);
    return `לא כלול באפשרות זו: ${labels.join(", ")}`;
  };

  const tiers = Array.isArray(social.membership_tiers) ? social.membership_tiers : [];
  const tierLines: string[] = [];
  for (const t of tiers) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    if (!name) continue;
    const price = String(o.price ?? "").trim();
    const monthly = String(o.monthly_sessions ?? "").trim();
    const notes = String(o.notes ?? "").trim();
    const ex = Array.isArray(o.excluded_service_slugs) ? o.excluded_service_slugs.map(String) : [];
    tierLines.push(
      `- ${name}${price ? ` | מחיר: ${truncateText(price, 40)}` : ""}${monthly ? ` | אימונים חודשיים: ${truncateText(monthly, 24)}` : ""} | ${excludedLine(ex)}${notes ? ` | הערות: ${truncateText(notes, 120)}` : ""}`
    );
  }

  const cards = Array.isArray(social.punch_cards) ? social.punch_cards : [];
  const cardLines: string[] = [];
  for (const c of cards) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const count = String(o.session_count ?? "").trim();
    const validity = String(o.validity ?? "").trim();
    if (!count && !validity) continue;
    const notes = String(o.notes ?? "").trim();
    const ex = Array.isArray(o.excluded_service_slugs) ? o.excluded_service_slugs.map(String) : [];
    cardLines.push(
      `- כמות אימונים: ${count || "—"} | תוקף: ${validity || "—"} | ${excludedLine(ex)}${notes ? ` | הערות: ${truncateText(notes, 120)}` : ""}`
    );
  }

  if (!tierLines.length && !cardLines.length) return "";
  const parts: string[] = [];
  if (tierLines.length) parts.push(`מנויים:\n${tierLines.join("\n")}`);
  if (cardLines.length) parts.push(`כרטיסיות:\n${cardLines.join("\n")}`);
  return parts.join("\n\n");
}

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
      admin
        .from("services")
        .select("name, description, price_text, location_text, service_slug")
        .eq("business_id", business.id)
        .order("created_at", { ascending: true }),
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

    const followupAfterRegistration =
      typeof social.followup_after_registration === "string" ? social.followup_after_registration.trim() : "";
    const followupAfterHourNoRegistration =
      typeof social.followup_after_hour_no_registration === "string"
        ? social.followup_after_hour_no_registration.trim()
        : "";
    const followupDayAfterTrial =
      typeof social.followup_day_after_trial === "string" ? social.followup_day_after_trial.trim() : "";

    const serviceNamesForOpening = (services ?? [])
      .map((s) => String(s.name ?? "").trim())
      .filter(Boolean);

    const membershipsAndCardsText = formatMembershipsAndCardsBlock(social, services ?? []);

    const benefitByName = new Map<string, string>();
    for (const s of services ?? []) {
      const n = String(s.name ?? "").trim();
      if (!n) continue;
      let benefit = "";
      try {
        const raw = String((s as { description?: string }).description ?? "");
        const meta = JSON.parse(raw || "{}") as Record<string, unknown>;
        benefit = String(meta.benefit_line ?? "").trim();
      } catch {
        /* legacy plain description */
      }
      benefitByName.set(n, benefit);
    }

    const salesFlowConfig = parseSalesFlowFromSocial(social.sales_flow);
    const salesFlowPromptSection = salesFlowConfig
      ? formatSalesFlowForPrompt(salesFlowConfig, serviceNamesForOpening, benefitByName)
      : "";

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
      followupAfterRegistration,
      followupAfterHourNoRegistration,
      followupDayAfterTrial,
      membershipsAndCardsText,
      salesFlowConfig,
      salesFlowPromptSection,
    };
  } catch (e) {
    console.warn("[business-context] getBusinessKnowledgePack failed:", e);
    return null;
  }
}

function formatSalesFlowBlocksForPrompt(blocks: SalesFlowBlockPack[]): string {
  if (!blocks.length) return "אין שלבים נוספים אחרי הודעת הפתיחה.";
  return blocks
    .map((b, i) => {
      const opts = b.options.map((o, j) => `  ${j + 1}. ${o}`).join("\n");
      return `שלב ${i + 2} (אחרי תשובה מתאימה מהלקוח):\nטקסט לפני שאלה: ${b.intro || "(ריק)"}\nשאלה: ${b.question || "(ריק)"}\nכפתורים:\n${opts || "  (אין)"}`;
    })
    .join("\n\n");
}

function formatFollowupSnippets(k: BusinessKnowledgePack | null): string {
  if (!k) return "";
  const parts: string[] = [];
  if (k.followupAfterRegistration) parts.push(`אחרי הרשמה:\n${k.followupAfterRegistration.slice(0, 400)}`);
  if (k.followupAfterHourNoRegistration)
    parts.push(`אחרי שעה בלי הרשמה:\n${k.followupAfterHourNoRegistration.slice(0, 350)}`);
  if (k.followupDayAfterTrial) parts.push(`אחרי שיעור ניסיון:\n${k.followupDayAfterTrial.slice(0, 350)}`);
  if (!parts.length) return "";
  return `\nדוגמאות טון מהודעות פולואפ שהוגדרו במערכת (שמרי על שפה עקבית; אל תחזירי את הטקסט הזה כולו כתשובה שגרתית):\n${parts.join("\n---\n")}\n`;
}

const RESPONSE_SHAPE_BLOCK_WEB = `
מבנה תשובה — ברירת מחדל של זואי (חובה כמעט תמיד):
1) מענה — השתמשי בידע מההגדרות למעלה (שירותים, מחירים, כתובת, FAQ, מסלול מכירה, לינק שעות אם קיים). אל תמציאי מחיר, מיקום או מדיניות שלא מופיעים.
2) שאלת המשך — שאלה אחת קצרה שמקדמת את השיחה (התאמה, ניסיון, זמינות).
3) אפשרויות בחירה (כמו כפתורי ווטסאפ) — מיד אחרי השאלה, 2–4 שורות; כל שורה מתחילה במספר ונקודה (1. 2. 3.) ואז טקסט קצר בעברית. לפחות אפשרות אחת מקדמת הרשמה או שריון לשיעור ניסיון / שירות המקביל בעסק; השאר רלוונטיות (מחיר, מיקום, שאלה נוספת).
גם כשהלקוח שואל שאלה פתוחה או לא לפי כפתורים — עני קודם על השאלה מהידע, ואז הוסיפי שלבים (2) ו־(3).
חריג נדיר: אם ביקשו במפורש רק תשובה חד־משמעית מינימלית בלי המשך — עדיין נסי להוסיף שאלה + לפחות שתי אפשרויות ממוספרות, אלא אם נאסר במפורש.`;

const RESPONSE_SHAPE_BLOCK_WA = `
מבנה תשובה — ברירת מחדל של זואי (חובה כמעט תמיד):
1) מענה קצר מהידע (שירותים, מחירים, כתובת, FAQ, מסלול מכירה, לינק שעות).
2) שאלת המשך אחת שמקדמת לעבר שריון ניסיון או התאמה.
3) הציעי 2–4 תשובות אפשריות כשורות נפרדות, ממוספרות 1. 2. 3. — הלקוח יכול לענות במספר או לפי הטקסט. לפחות מסלול אחד מוביל לשיעור ניסיון / הרשמה.
גם לשאלות פתוחות: עני מהידע, ואז (2)+(3). בלי Markdown.`;

export function buildSystemPrompt(knowledge: BusinessKnowledgePack | null, slug: string, channel: "web" | "whatsapp" = "web"): string {
  const isWhatsApp = channel === "whatsapp";
  const vibeDetail = buildVibeInstructionLines(knowledge?.vibeLabels ?? []);
  const channelNote = isWhatsApp
    ? `
- ערוץ: WhatsApp — תשובות קצרות במיוחד (משפט אחד עד שניים לכל חלק), ללא Markdown, ללא כוכביות.
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
- שמרי על מבנה התשובה (מענה → שאלה → אפשרויות ממוספרות).${isWhatsApp ? " הקפידי על קצרנות בכל חלק." : " בצ'אט האתר מותר להרחיב במענה הראשון אם ביקשו פירוט."}
- בלי Markdown, בלי JSON.
- אם נשאל על הרשמה/תשלום: לכלול CTA אם קיים.${channelNote}
${isWhatsApp ? RESPONSE_SHAPE_BLOCK_WA : RESPONSE_SHAPE_BLOCK_WEB}
${formatFollowupSnippets(knowledge)}

ידע עסקי:
נישה: ${knowledge?.niche ?? ""}
תיאור עסק: ${knowledge?.businessDescription ?? "לא הוגדר"}
שירותים:
${knowledge?.servicesText ?? "לא הוגדר"}
${knowledge?.membershipsAndCardsText ? `מנויים וכרטיסיות:\n${knowledge.membershipsAndCardsText}\n` : ""}FAQ:
${knowledge?.faqsText ?? "לא הוגדר"}
CTA: ${knowledge?.ctaText ?? "לא הוגדר"} | ${knowledge?.ctaLink ?? "לא הוגדר"}
קהל יעד: ${knowledge?.targetAudienceText ?? "לא הוגדר"} | גיל: ${knowledge?.ageRangeText ?? "לא הוגדר"} | מגדר: ${knowledge?.genderText ?? "לא הוגדר"}
יתרונות: ${knowledge?.benefitsText ?? "לא הוגדר"}
שעות פעילות: ${knowledge?.scheduleText ?? "לא הוגדר"}
`;

  const openingIntro = knowledge?.welcomeIntroText?.trim() ?? "";
  const openingQ = knowledge?.welcomeQuestionText?.trim() ?? "";
  const openingOpts = (knowledge?.welcomeOptionLabels ?? []).join(" | ");
  const saleFlowExtra = knowledge?.salesFlowPromptSection?.trim()
    ? `${knowledge.salesFlowPromptSection}\n\nנסחי בהתאם לסגנון הדיבור שנבחר למעלה.`
    : `
מסלול מכירה מהדשבורד (מבנה ישן):
- פתיחה (לעיונך / אם צריך לשחזר בצ'אט): ${openingIntro || "ברירת מחדל לפי שם בוט, עסק, כתובת"} | שאלה: ${openingQ || "—"} | כפתורים: ${openingOpts || "—"}
- שלבים נוספים אחרי תשובה לפתיחה:
${formatSalesFlowBlocksForPrompt(knowledge?.salesFlowBlocks ?? [])}
- נסחי בהתאם לסגנון הדיבור שנבחר למעלה.`;

  if (!isWhatsApp) {
    return `${base}
${saleFlowExtra}`;
  }

  return `${base}

הוראות ספציפיות לזרימת וואטסאפ (מסלול מכירה מהדשבורד):
- הודעת הפתיחה נשלחת אוטומטית מהמערכת לפי ההגדרות — אל תחזירי אותה מחדש בתשובתך הראשונה אלא אם התבקשת במפורש.
${saleFlowExtra}
- אם יש לינק Arbox/שעות: ${knowledge?.arboxLink ? "הציעי את הקישור המתאים (הרשמה / מחירים) כשזה עוזר ללקוח — בלי למציא קישורים." : "אין לינק — אל תמציאי."}
- לעולם אל תשתמשי ב-Markdown או ברשימות תבליטים; בוואטסאפ הטקסט חייב להיות פשוט וברור.
`;
}
