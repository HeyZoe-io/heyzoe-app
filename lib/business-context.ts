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
  taglineText: string;
  businessDescription: string;
  addressText: string;
  /** הנחיות הגעה (social_links.directions) — לשליחה אוטומטית בווטסאפ וכו׳ */
  directionsText: string;
  directionsMediaUrl: string;
  directionsMediaType: "image" | "video" | "";
  /** טלפון לשירות לקוחות כשזואי אינה מוצאת תשובה מדויקת בידע */
  customerServicePhone: string;
  arboxLink: string;
  /** קישור לוח שיעורים ציבורי (social_links.schedule_public_url / arbox_schedule_url) */
  schedulePublicUrl: string;
  /** קישור לדף מנויים וכרטיסיות (social_links.memberships_url) */
  membershipsUrl: string;
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
  /** הודעת פולואפ ווטסאפ אוטומטית לליד שאינו מגיב (למחרת בבוקר) */
  whatsappIdleFollowupMessage: string;
  whatsappIdleFollowupCtaKind: "trial" | "schedule" | "custom";
  whatsappIdleFollowupCtaLabel: string;
  membershipsAndCardsText: string;
  salesFlowConfig: SalesFlowConfig | null;
  salesFlowPromptSection: string;
  /** קישור אינסטגרם (social_links.instagram) */
  instagramUrl: string;
  promotionsText: string;
};

function formatMembershipsLinkLine(social: Record<string, unknown>): string {
  const url = typeof social.memberships_url === "string" ? social.memberships_url.trim() : "";
  if (!url) return "";
  return `קישור לדף מנויים וכרטיסיות (להפניה כששואלים על מחירים): ${url}`;
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

function parseServiceMeta(rawDescription: string): Record<string, unknown> {
  const trimmed = rawDescription.trim();
  if (!trimmed) return {};
  const candidate = trimmed.startsWith("__META__:") ? trimmed.slice("__META__:".length).trim() : trimmed;
  if (!candidate.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function getBusinessKnowledgePack(slug: string): Promise<BusinessKnowledgePack | null> {
  const cache = ((globalThis as unknown as { __hzBizPackCache?: Map<string, { at: number; v: BusinessKnowledgePack | null }> }).__hzBizPackCache ??=
    new Map<string, { at: number; v: BusinessKnowledgePack | null }>());
  const now = Date.now();
  const hit = cache.get(slug);
  // Short TTL to keep chats snappy while reflecting dashboard edits quickly.
  if (hit && now - hit.at < 8_000) {
    return hit.v;
  }
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
      ? services
          .slice(0, 6)
          .map((s, i) => {
            const meta = parseServiceMeta(String(s.description ?? ""));
            const descriptionText = String(meta.description_text ?? meta.description ?? s.description ?? "").trim();
            const levels = Array.isArray(meta.levels)
              ? meta.levels.map((x) => String(x ?? "").trim()).filter(Boolean)
              : [];
            const levelsText =
              meta.levels_enabled === true && levels.length > 0 ? ` | רמות: ${levels.join(", ")}` : "";
            return `${i + 1}. ${truncateText(String(s.name ?? ""), 60)} | מחיר: ${truncateText(String(s.price_text ?? "לא צוין"), 40)} | מיקום: ${s.location_text ?? "לא צוין"}${levelsText} | תיאור: ${truncateText(descriptionText, 140)}`;
          })
          .join("\n")
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
    const directionsText = typeof social.directions === "string" ? String(social.directions).trim() : "";
    const directionsMediaUrl =
      typeof social.directions_media_url === "string" ? String(social.directions_media_url).trim() : "";
    const directionsMediaType =
      social.directions_media_type === "image" || social.directions_media_type === "video"
        ? (social.directions_media_type as "image" | "video")
        : "";
    const customerServicePhone =
      typeof social.customer_service_phone === "string"
        ? String(social.customer_service_phone).trim()
        : "";
    const arboxLink = typeof social.arbox_link === "string" ? String(social.arbox_link).trim() : "";
    const schedulePublicUrlRaw =
      typeof social.schedule_public_url === "string"
        ? String(social.schedule_public_url).trim()
        : typeof social.arbox_schedule_url === "string"
          ? String(social.arbox_schedule_url).trim()
          : "";
    const schedulePublicUrl = schedulePublicUrlRaw;
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
    const promotionsText = typeof social.promotions === "string" ? social.promotions.trim() : "";

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

    const whatsappIdleFollowupMessage = (() => {
      const key =
        typeof social.whatsapp_idle_followup_message === "string"
          ? social.whatsapp_idle_followup_message.trim()
          : "";
      if (key) return key;
      const legacyHour =
        typeof social.followup_after_hour_no_registration === "string"
          ? social.followup_after_hour_no_registration.trim()
          : "";
      const legacyTrial =
        typeof social.followup_day_after_trial === "string" ? social.followup_day_after_trial.trim() : "";
      return legacyHour || legacyTrial;
    })();

    const ctaKindRaw = String(social.whatsapp_idle_followup_cta_kind ?? "trial").trim();
    const whatsappIdleFollowupCtaKind: "trial" | "schedule" | "custom" =
      ctaKindRaw === "schedule" || ctaKindRaw === "custom" ? ctaKindRaw : "trial";
    const whatsappIdleFollowupCtaLabel =
      typeof social.whatsapp_idle_followup_cta_label === "string" &&
      social.whatsapp_idle_followup_cta_label.trim()
        ? social.whatsapp_idle_followup_cta_label.trim()
        : whatsappIdleFollowupCtaKind === "schedule"
          ? "צפייה במערכת השעות"
          : whatsappIdleFollowupCtaKind === "custom"
            ? "לחצו כאן"
            : "הרשמה לשיעור ניסיון";

    const serviceNamesForOpening = (services ?? [])
      .map((s) => String(s.name ?? "").trim())
      .filter(Boolean);

    const membershipsUrl =
      typeof social.memberships_url === "string" ? String(social.memberships_url).trim() : "";
    const instagramUrl =
      typeof social.instagram === "string" ? String(social.instagram).trim() : "";
    const membershipsAndCardsText = formatMembershipsLinkLine(social);

    const benefitByName = new Map<string, string>();
    for (const s of services ?? []) {
      const n = String(s.name ?? "").trim();
      if (!n) continue;
      let benefit = "";
      try {
        const raw = String((s as { description?: string }).description ?? "");
        const meta = parseServiceMeta(raw);
        benefit = String(meta.benefit_line ?? "").trim();
      } catch {
        /* legacy plain description */
      }
      benefitByName.set(n, benefit);
    }

    const salesFlowConfig = parseSalesFlowFromSocial(social.sales_flow);
    const salesFlowPromptSection = salesFlowConfig
      ? formatSalesFlowForPrompt(
          salesFlowConfig,
          serviceNamesForOpening,
          benefitByName,
          instagramUrl,
          addressText,
          directionsText
        )
      : "";

    const packed: BusinessKnowledgePack = {
      businessName: String(business.name ?? slug),
      botName: String(business.bot_name ?? "זואי").trim() || "זואי",
      niche: String(business.niche ?? ""),
      taglineText: tagline,
      businessDescription: sanitizeText(businessDescriptionRaw, 350),
      addressText,
      directionsText,
      directionsMediaUrl,
      directionsMediaType,
      customerServicePhone,
      arboxLink,
      schedulePublicUrl,
      membershipsUrl,
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
      whatsappIdleFollowupMessage,
      whatsappIdleFollowupCtaKind,
      whatsappIdleFollowupCtaLabel,
      membershipsAndCardsText,
      salesFlowConfig,
      salesFlowPromptSection,
      instagramUrl,
      promotionsText,
    };
    cache.set(slug, { at: now, v: packed });
    return packed;
  } catch (e) {
    console.warn("[business-context] getBusinessKnowledgePack failed:", e);
    cache.set(slug, { at: now, v: null });
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
  if (!k?.whatsappIdleFollowupMessage?.trim()) return "";
  const t = k.whatsappIdleFollowupMessage.trim().slice(0, 450);
  const kindHint =
    k.whatsappIdleFollowupCtaKind === "trial"
      ? "כפתור הקישור מוביל לדף רכישת אימון ניסיון (לינק סליקה מהאימון הראשון בהגדרות)."
      : k.whatsappIdleFollowupCtaKind === "schedule"
        ? "כפתור הקישור מוביל למערכת השעות."
        : "כפתור הקישור מוביל לכתובת מותאמת שהעסק הגדיר.";
  return `\nדוגמה לטון מהודעת הפולואפ האוטומטית (למחרת בבוקר לליד שאינו מגיב; שמרי על שפה עקבית; אל תחזירי את הטקסט כולו כתשובה שגרתית):\n${t}\nתווית הכפתור בהגדרות: «${k.whatsappIdleFollowupCtaLabel}». ${kindHint}\n`;
}

function formatUnknownKnowledgeBlock(phoneDisplay: string): string {
  const phoneHint =
    phoneDisplay && phoneDisplay !== "לא הוגדר"
      ? `- אם בשדה «טלפון שירות לקוחות» למעלה מופיע מספר — הציעי ליצור קשר ישירות עם העסק בטלפון הזה; הציגי את המספר בדיוק כפי שמופיע (כולל קידומת), בלי לשנות ספרות.`
      : `- טלפון שירות לקוחות לא הוגדר בידע — אל תמציאי מספר; הציעי לפנות לעסק דרך לינק שעות או פרטים אחרים שכן מופיעים בידע, בלי להמציא.`;
  return `
חוסר ידע מדויק — כששאלה פתוחה איננה ניתנת למענה ישיר ומדויק מהידע העסקי (אין ב-FAQ, בשירותים, במחירים, במנויים, בתיאור העסק או בשדות קשורים שעונים ישירות על השאלה):
- התנצלות קצרה שלא מצאת את המידע המדויק; אל תמציאי, אל תנחשי ואל תשלימי בכלליות כאילו ידוע.
${phoneHint}
- לאחר מכן המשיכי עם שאלת המשך ואפשרויות ממוספרות כרגיל (שלבים 2 ו־3 במבנה התשובה).
`;
}

const RESPONSE_SHAPE_BLOCK_WEB = `
מבנה תשובה — ברירת מחדל של זואי (חובה כמעט תמיד):
1) מענה — השתמשי בידע ממסלול המכירה למעלה (שירותים, מחירים, כתובת, FAQ, לינק שעות אם קיים). אל תמציאי מחיר, מיקום או מדיניות שלא מופיעים.
2) שאלת המשך — שאלה אחת קצרה שמקדמת את השיחה (התאמה, ניסיון, זמינות).
3) אפשרויות בחירה (כמו כפתורי ווטסאפ) — מיד אחרי השאלה, 2–4 שורות; כל שורה מתחילה במספר ונקודה (1. 2. 3.) ואז טקסט קצר בעברית. לפחות אפשרות אחת מקדמת הרשמה או שריון לשיעור ניסיון / שירות המקביל בעסק; השאר רלוונטיות (מחיר, מיקום, שאלה נוספת).
גם כשהלקוח שואל שאלה פתוחה — אם יש בידע מענה מדויק וישיר עני מהידע, ואז (2) ו־(3). אם אין בידע מענה כזה — אל תנחשי ואל תמלאי בכלליות; עברי לסעיף «חוסר ידע מדויק» שמופיע אחרי בלוק הידע העסקי.
חריג נדיר: אם ביקשו במפורש רק תשובה חד־משמעית מינימלית בלי המשך — עדיין נסי להוסיף שאלה + לפחות שתי אפשרויות ממוספרות, אלא אם נאסר במפורש.`;

const RESPONSE_SHAPE_BLOCK_WA = `
מבנה תשובה — ברירת מחדל של זואי (חובה כמעט תמיד):
1) מענה קצר מהידע (שירותים, מחירים, כתובת, FAQ, מסלול מכירה, לינק שעות).
2) שאלת המשך אחת שמקדמת לעבר שריון ניסיון או התאמה.
3) הציעי 2–4 תשובות אפשריות כשורות נפרדות, ממוספרות 1. 2. 3. — הלקוח יכול לענות במספר או לפי הטקסט. לפחות מסלול אחד מוביל לשיעור ניסיון / הרשמה.
גם לשאלות פתוחות: אם יש מענה מדויק בידע — עני ואז (2)+(3). אם אין — אל תנחשי; עברי לסעיף «חוסר ידע מדויק» אחרי בלוק הידע. בלי Markdown.`;

export function buildSystemPrompt(
  knowledge: BusinessKnowledgePack | null,
  slug: string,
  channel: "web" | "whatsapp" = "web"
): string {
  const isWhatsApp = channel === "whatsapp";
  const customerPhoneRaw = knowledge?.customerServicePhone?.trim() ?? "";
  const customerPhoneDisplay = customerPhoneRaw || "לא הוגדר";
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
- זמני שיעורים: השתמשי רק במידע שמופיע בידע העסקי או בלינק מערכת השעות; אל תמציאי שעות.
- שמרי על מבנה התשובה (מענה → שאלה → אפשרויות ממוספרות).${isWhatsApp ? " הקפידי על קצרנות בכל חלק." : " בצ'אט האתר מותר להרחיב במענה הראשון אם ביקשו פירוט."}
- בלי Markdown, בלי JSON.
- כתבי תמיד בניסוח ניטרלי שאינו מניח מגדר של איש צוות או מדריך; למשל להעדיף "באימון אנחנו דואגים להוביל" ולא "המורה שלנו מובילה/מוביל".
- השתמשי בעברית טבעית עם שמות עצם תקינים; לדוגמה "בביטחון ובכיף" ולא "בטוח וכיפי".
- אם נשאל על הרשמה/תשלום: לכלול CTA אם קיים.${channelNote}
${isWhatsApp ? RESPONSE_SHAPE_BLOCK_WA : RESPONSE_SHAPE_BLOCK_WEB}
${formatFollowupSnippets(knowledge)}

ידע עסקי:
נישה: ${knowledge?.niche ?? ""}
תיאור עסק: ${knowledge?.businessDescription ?? "לא הוגדר"}
הנחות ומבצעים: ${knowledge?.promotionsText?.trim() || "לא הוגדר"}
שירותים:
${knowledge?.servicesText ?? "לא הוגדר"}
${knowledge?.membershipsAndCardsText ? `מנויים וכרטיסיות:\n${knowledge.membershipsAndCardsText}\n` : ""}FAQ:
${knowledge?.faqsText ?? "לא הוגדר"}
CTA: ${knowledge?.ctaText ?? "לא הוגדר"} | ${knowledge?.ctaLink ?? "לא הוגדר"}
קהל יעד: ${knowledge?.targetAudienceText ?? "לא הוגדר"} | גיל: ${knowledge?.ageRangeText ?? "לא הוגדר"} | מגדר: ${knowledge?.genderText ?? "לא הוגדר"}
יתרונות: ${knowledge?.benefitsText ?? "לא הוגדר"}
שעות פעילות: ${knowledge?.scheduleText ?? "לא הוגדר"}
טלפון שירות לקוחות (לפניה ישירה כשאין תשובה מדויקת בידע): ${customerPhoneDisplay}
${formatUnknownKnowledgeBlock(customerPhoneDisplay)}
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
- הודעת הפתיחה נשלחת אוטומטית מהמערכת לפי מסלול המכירה — אל תחזירי אותה מחדש בתשובתך הראשונה אלא אם התבקשת במפורש.
${saleFlowExtra}
- אם יש לינק מערכת שעות: ${knowledge?.schedulePublicUrl || knowledge?.arboxLink ? "הציעי את הקישור המתאים כשזה עוזר ללקוח — בלי להמציא קישורים." : "אין לינק — אל תמציאי."}
- לעולם אל תשתמשי ב-Markdown או ברשימות תבליטים; בוואטסאפ הטקסט חייב להיות פשוט וברור.
`;
}
