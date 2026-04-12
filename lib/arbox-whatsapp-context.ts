import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ARBOX_CACHE_TTL_MS,
  arboxCreateLead,
  buildArboxWhatsAppRegistrationSummary,
  extractArboxLeadIdFromCreateResponse,
  extractArboxUserIdFromSearchResponse,
} from "@/lib/arbox-public-api";

const regSummaryCache = new Map<string, { at: number; lines: string[]; rawUser: unknown }>();

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
 * מטמון 30 דק׳ לקריאות GET; כשל Arbox לא חוסם את זואי.
 */
export async function getArboxWhatsappPromptAppend(params: ArboxWhatsappContextParams): Promise<string> {
  const { supabase, businessId, business_slug, apiKey, phone, fullName, createLead } = params;
  const key = apiKey.trim();
  if (!key) return "";

  const ck = cacheKey(business_slug, phone);
  const now = Date.now();
  let lines: string[] | null = null;
  let rawUser: unknown = null;
  const hit = regSummaryCache.get(ck);
  if (hit && now - hit.at < ARBOX_CACHE_TTL_MS) {
    lines = hit.lines;
    rawUser = hit.rawUser;
  } else {
    const built = await buildArboxWhatsAppRegistrationSummary(key, phone, { useCache: true });
    lines = built.lines;
    rawUser = built.raw.user;
    regSummaryCache.set(ck, { at: now, lines, rawUser });
  }

  const userId = extractArboxUserIdFromSearchResponse(rawUser);
  if (userId) {
    try {
      const { error: upUserErr } = await supabase
        .from("contacts")
        .update({ arbox_user_id: userId })
        .eq("business_id", Number(businessId))
        .eq("phone", phone);
      if (upUserErr) console.warn("[Arbox WA] arbox_user_id update:", upUserErr.message);
    } catch (e) {
      console.warn("[Arbox WA] arbox_user_id update threw:", e);
    }
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
        const leadId = extractArboxLeadIdFromCreateResponse(leadRes.data);
        parts.push("יצירת ליד: נרשם ליד חדש ב-Arbox עבור מספר זה (HeyZoe WhatsApp).");
        try {
          const patch: Record<string, unknown> = {
            arbox_lead_created_at: new Date().toISOString(),
          };
          if (leadId) patch.arbox_lead_id = leadId;
          const { error: upErr } = await supabase
            .from("contacts")
            .update(patch as never)
            .eq("business_id", Number(businessId))
            .eq("phone", phone);
          if (upErr) console.warn("[Arbox WA] arbox_lead_* update:", upErr.message);
        } catch (e) {
          console.warn("[Arbox WA] arbox_lead_* update threw:", e);
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
