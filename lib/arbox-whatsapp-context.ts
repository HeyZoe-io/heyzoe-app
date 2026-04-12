import type { SupabaseClient } from "@supabase/supabase-js";
import {
  arboxCreateLead,
  buildArboxWhatsAppRegistrationSummary,
} from "@/lib/arbox-public-api";

const REG_CACHE_TTL_MS = 8 * 60 * 1000;
const regSummaryCache = new Map<string, { at: number; lines: string[] }>();

function cacheKey(slug: string, phone: string): string {
  return `${slug}::${phone}`;
}

export type ArboxWhatsappContextParams = {
  supabase: SupabaseClient;
  businessId: string;
  business_slug: string;
  apiKey: string;
  phone: string;
  fullName: string;
  /** false בהודעת פתיחה ראשונה — לא ליצור ליד לפני שהלקוח קיבל את הפתיחה */
  createLead: boolean;
};

/**
 * טקסט שמוצמד ל-system prompt בווטסאפ: סטטוס משתמש/ליד/ניסיון מ-Arbox + יצירת ליד חד־פעמית.
 */
export async function getArboxWhatsappPromptAppend(params: ArboxWhatsappContextParams): Promise<string> {
  const { supabase, businessId, business_slug, apiKey, phone, fullName, createLead } = params;
  const key = apiKey.trim();
  if (!key) return "";

  const ck = cacheKey(business_slug, phone);
  const now = Date.now();
  let lines: string[] | null = null;
  const hit = regSummaryCache.get(ck);
  if (hit && now - hit.at < REG_CACHE_TTL_MS) {
    lines = hit.lines;
  } else {
    const built = await buildArboxWhatsAppRegistrationSummary(key, phone);
    lines = built.lines;
    regSummaryCache.set(ck, { at: now, lines });
  }

  const parts: string[] = [
    "---",
    "ארבוקס — מידע פנימי לפי מספר הווטסאפ של השולח (אל תחשפי מפתחות API; הציגי למשתמש רק מה שרלוונטי ומדויק):",
    ...(lines ?? []),
  ];

  if (createLead) {
    let already = false;
    try {
      const { data: row, error } = await supabase
        .from("contacts")
        .select("arbox_lead_created_at")
        .eq("business_id", Number(businessId))
        .eq("phone", phone)
        .maybeSingle();
      if (error) {
        console.warn("[Arbox WA] contacts select arbox_lead_created_at:", error.message);
      } else {
        already = Boolean((row as { arbox_lead_created_at?: string } | null)?.arbox_lead_created_at);
      }
    } catch (e) {
      console.warn("[Arbox WA] contacts select threw:", e);
    }

    if (!already) {
      const leadRes = await arboxCreateLead(key, phone, fullName);
      if (leadRes.ok) {
        parts.push("יצירת ליד: נרשם ליד חדש ב-Arbox עבור מספר זה (HeyZoe WhatsApp).");
        try {
          const { error: upErr } = await supabase
            .from("contacts")
            .update({ arbox_lead_created_at: new Date().toISOString() })
            .eq("business_id", Number(businessId))
            .eq("phone", phone);
          if (upErr) console.warn("[Arbox WA] arbox_lead_created_at update:", upErr.message);
        } catch (e) {
          console.warn("[Arbox WA] arbox_lead_created_at update threw:", e);
        }
      } else {
        parts.push(`יצירת ליד: נכשלה (${leadRes.message}).`);
      }
    } else {
      parts.push("יצירת ליד: כבר בוצעה בעבר למספר זה במערכת HeyZoe.");
    }
  }

  return parts.join("\n");
}
