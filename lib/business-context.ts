import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type QuickReplyEntry = { label: string; reply: string };

export type BusinessKnowledgePack = {
  businessName: string;
  niche: string;
  businessDescription: string;
  servicesText: string;
  faqsText: string;
  ctaText: string;
  ctaLink: string;
  targetAudienceText: string;
  benefitsText: string;
  vibeText: string;
  ageRangeText: string;
  genderText: string;
  scheduleText: string;
  quickReplies: QuickReplyEntry[];
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
      .select("id, name, niche, cta_text, cta_link, social_links")
      .eq("slug", slug)
      .maybeSingle();
    if (!business) return null;

    const [{ data: services }, { data: faqs }] = await Promise.all([
      admin.from("services").select("name, description, price_text, location_text").eq("business_id", business.id).order("created_at", { ascending: true }),
      admin.from("faqs").select("question, answer").eq("business_id", business.id).order("sort_order", { ascending: true }),
    ]);

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

    return {
      businessName: String(business.name ?? slug),
      niche: String(business.niche ?? ""),
      businessDescription: sanitizeText(String(social.business_description ?? ""), 350),
      servicesText,
      faqsText,
      ctaText: String(business.cta_text ?? ""),
      ctaLink: String(business.cta_link ?? ""),
      targetAudienceText: Array.isArray(social.target_audience) ? social.target_audience.join(", ") : "",
      benefitsText: Array.isArray(social.benefits) ? social.benefits.join(", ") : "",
      vibeText: Array.isArray(social.vibe) ? social.vibe.join(", ") : "",
      ageRangeText: typeof social.age_range === "string" ? social.age_range : "",
      genderText: social.gender === "זכר" || social.gender === "נקבה" || social.gender === "הכול" ? social.gender as string : "",
      scheduleText: typeof social.schedule_text === "string" ? social.schedule_text : "",
      quickReplies,
    };
  } catch (e) {
    console.warn("[business-context] getBusinessKnowledgePack failed:", e);
    return null;
  }
}

export function buildSystemPrompt(knowledge: BusinessKnowledgePack | null, slug: string, channel: "web" | "whatsapp" = "web"): string {
  const isWhatsApp = channel === "whatsapp";
  const channelNote = isWhatsApp
    ? `
- ערוץ: WhatsApp — תשובות קצרות במיוחד (משפט אחד עד שניים), ללא Markdown, ללא כוכביות.
- השתמשי בכפתורי התפריט (quick replies) שהוגדרו בדשבורד ולא בכתיבה חופשית עבור בחירת אפשרויות.`
    : "";

  const base = `את זואי, נציגת השירות של העסק.
שם העסק: ${knowledge?.businessName ?? slug}
סגנון דיבור (Vibe): ${knowledge?.vibeText ?? "חם, מקצועי וקצר"}

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

  if (!isWhatsApp) return base;

  return `${base}

הוראות ספציפיות לזרימת וואטסאפ:
- ההודעה הראשונה ללקוח צריכה לכלול:
  1) משפט פתיחה קצר שמציג את העסק בשורה אחת (שם העסק + תחום).
  2) כתובת / אזור פעילות מרכזי אם ידוע.
  3) רשימה קצרה מאוד של השירותים העיקריים עם מחירים (עד 3 שירותים בשורה נפרדת לכל שירות).
  4) שאלה מסכמת: "האם יצא לך לנסות את התחום הזה בעבר?".
  5) שלושה כפתורי בחירה לתשובה: "לא יצא לי", "יצא לי פעם-פעמיים", "יצא לי לא מעט פעמים".
- לאחר בחירת אחת משלוש הרמות, התשובה הבאה צריכה:
  1) להתייחס בקצרה לרמת הניסיון (ללא חקירה ארוכה).
  2) להציג שני כפתורים:
     - "צפה בלו״ז והירשם" — משויך ללינק Arbox / הרשמה מהדשבורד אם קיים.
     - "שאלות נוספות" — פותח תפריט כפתורי תשובה מהירה (quick replies) שהוגדרו בדשבורד.
- שאלות הסגמנטציה שהוגדרו בדשבורד (Segmentation Questions) יופיעו רק אחרי שאלת הפתיחה, ורק אם המשתמש בחר להמשיך לשיחה כללית ולא נרשם עדיין.
- לעולם אל תשתמשי ב-Markdown או ברשימות תבליטים; בוואטסאפ הטקסט חייב להיות פשוט וברור.
`;
}
