import { logMessage } from "@/lib/analytics";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { logMarketingWhatsAppMessage, MARKETING_CONVERSATIONS_SLUG } from "@/lib/marketing-whatsapp";
import { buildWaSessionId, contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { extractPhoneFromSessionId } from "@/lib/conversations-sessions";
import {
  digitsForMarketingLineCompare,
  isWaUnsupportedLogContent,
  isZoeAdminWhatsAppPhone,
  WA_ZOE_ADMIN_TEMPLATE_MODEL,
} from "@/lib/wa-inbound-unsupported";
import type { OwnerTemplateComponent } from "@/lib/notifications/sendOwnerNotification";

function paramsForType(
  components: OwnerTemplateComponent[] | undefined,
  type: "body" | "header"
): string[] {
  const hit = (components ?? []).find((c) => c.type === type);
  return (hit?.parameters ?? []).map((p) => String(p.text ?? "").trim());
}

function substitutePlaceholders(text: string, params: string[]): string {
  return String(text ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => {
    const idx = Number(n) - 1;
    if (!Number.isFinite(idx) || idx < 0) return `{{${n}}}`;
    return params[idx] ?? `{{${n}}}`;
  });
}

export function renderWhatsAppTemplatePreview(input: {
  templateName: string;
  metaComponents?: unknown;
  sendComponents?: OwnerTemplateComponent[];
}): string {
  const name = String(input.templateName ?? "").trim() || "template";
  const headerParams = paramsForType(input.sendComponents, "header");
  const bodyParams = paramsForType(input.sendComponents, "body");
  const meta = Array.isArray(input.metaComponents) ? input.metaComponents : [];

  const lines: string[] = [];
  const buttons: string[] = [];

  for (const raw of meta) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { type?: unknown; text?: unknown; format?: unknown; buttons?: unknown };
    const type = String(c.type ?? "").toUpperCase();
    if (type === "HEADER" && String(c.format ?? "TEXT").toUpperCase() === "TEXT") {
      const t = substitutePlaceholders(String(c.text ?? ""), headerParams.length ? headerParams : bodyParams).trim();
      if (t) lines.push(t);
      continue;
    }
    if (type === "BODY") {
      const t = substitutePlaceholders(String(c.text ?? ""), bodyParams).trim();
      if (t) lines.push(t);
      continue;
    }
    if (type === "FOOTER") {
      const t = String(c.text ?? "").trim();
      if (t) lines.push(t);
      continue;
    }
    if (type === "BUTTONS" && Array.isArray(c.buttons)) {
      for (const b of c.buttons) {
        if (!b || typeof b !== "object") continue;
        const label = String((b as { text?: unknown }).text ?? "").trim();
        if (label) buttons.push(label);
      }
    }
  }

  let text = lines.join("\n\n").trim();
  if (!text) {
    const bits = [...headerParams, ...bodyParams].filter(Boolean);
    text = bits.length ? `הודעת תבנית (${name})\n\n${bits.join("\n")}` : `הודעת תבנית (${name})`;
  }
  for (const label of buttons) {
    text += `\n\n[כפתור: ${label}]`;
  }
  return text;
}

async function loadTemplateComponents(templateName: string): Promise<unknown> {
  const admin = createSupabaseAdminClient();
  const { data: biz } = await admin
    .from("businesses")
    .select("id")
    .ilike("slug", MARKETING_CONVERSATIONS_SLUG)
    .maybeSingle();
  const businessId = Number((biz as { id?: number } | null)?.id ?? 0);
  if (!Number.isFinite(businessId) || businessId <= 0) return null;

  const { data, error } = await admin
    .from("whatsapp_templates")
    .select("components")
    .eq("business_id", businessId)
    .eq("name", templateName)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[wa-zoe-admin-template-log] template lookup failed:", error.message);
    return null;
  }
  return (data as { components?: unknown } | null)?.components ?? null;
}

function phonesMatch(a: string, b: string): boolean {
  const da = digitsForMarketingLineCompare(a) || String(a ?? "").replace(/\D/g, "");
  const db = digitsForMarketingLineCompare(b) || String(b ?? "").replace(/\D/g, "");
  if (da && db && da === db) return true;
  const va = new Set(contactPhoneLookupVariants(a));
  return contactPhoneLookupVariants(b).some((v) => va.has(v));
}

/**
 * אחרי שליחת טמפלייט ממספר זואי: רושמים את התוכן בשיחת היעד
 * (Meta לא מחזירה גוף בהודעת WABA→WABA, type=unsupported).
 *
 * IO: 1–2 שאילתות ממוקדות + עד 2 inserts ל-messages, לכל שליחת התראה.
 */
export async function logZoeAdminTemplateToConversations(input: {
  toPhone: string;
  templateName: string;
  sendComponents?: OwnerTemplateComponent[];
}): Promise<void> {
  const toPhone = String(input.toPhone ?? "").trim();
  const templateName = String(input.templateName ?? "").trim();
  if (!toPhone || !templateName) return;

  let metaComponents: unknown = null;
  try {
    metaComponents = await loadTemplateComponents(templateName);
  } catch (e) {
    console.warn("[wa-zoe-admin-template-log] load components failed:", e);
  }

  const content = renderWhatsAppTemplatePreview({
    templateName,
    metaComponents,
    sendComponents: input.sendComponents,
  });

  try {
    await logMarketingWhatsAppMessage({
      leadPhone: toPhone,
      role: "assistant",
      content,
      model_used: WA_ZOE_ADMIN_TEMPLATE_MODEL,
    });
  } catch (e) {
    console.error("[wa-zoe-admin-template-log] marketing log failed:", e);
  }

  try {
    const admin = createSupabaseAdminClient();
    const { data: channels, error } = await admin
      .from("whatsapp_channels")
      .select("business_slug, phone_number_id, phone_display")
      .eq("is_active", true);
    if (error) {
      console.error("[wa-zoe-admin-template-log] channel lookup failed:", error.message);
      return;
    }

    const zoePhone = digitsForMarketingLineCompare(
      process.env.MARKETING_WA_DISPLAY_PHONE?.trim() || ""
    ) || "97233824981";

    for (const row of channels ?? []) {
      const display = String((row as { phone_display?: string }).phone_display ?? "").trim();
      if (!display || !phonesMatch(display, toPhone)) continue;
      const slug = String((row as { business_slug?: string }).business_slug ?? "").trim().toLowerCase();
      const phoneNumberId = String((row as { phone_number_id?: string }).phone_number_id ?? "").trim();
      const sessionId = buildWaSessionId(phoneNumberId, zoePhone);
      if (!slug || !sessionId) continue;
      await logMessage({
        business_slug: slug,
        role: "user",
        content,
        model_used: WA_ZOE_ADMIN_TEMPLATE_MODEL,
        session_id: sessionId,
      });
    }
  } catch (e) {
    console.error("[wa-zoe-admin-template-log] studio conversation log failed:", e);
  }
}

export async function recentZoeAdminTemplateAlreadyLogged(input: {
  businessSlug: string;
  sessionId: string;
}): Promise<boolean> {
  const businessSlug = String(input.businessSlug ?? "").trim().toLowerCase();
  const sessionId = String(input.sessionId ?? "").trim();
  if (!businessSlug || !sessionId) return false;
  try {
    const admin = createSupabaseAdminClient();
    const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from("messages")
      .select("model_used, content, created_at")
      .eq("business_slug", businessSlug)
      .eq("session_id", sessionId)
      .eq("role", "user")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(3);
    if (error) {
      console.warn("[wa-zoe-admin-template-log] dedup lookup failed:", error.message);
      return false;
    }
    return (data ?? []).some((row) => {
      const model = String((row as { model_used?: string | null }).model_used ?? "");
      const content = String((row as { content?: string }).content ?? "");
      return model === WA_ZOE_ADMIN_TEMPLATE_MODEL && content && !isWaUnsupportedLogContent(content);
    });
  } catch (e) {
    console.warn("[wa-zoe-admin-template-log] dedup lookup exception:", e);
    return false;
  }
}

/**
 * כשמגיעה הודעת unsupported ממספר זואי — ננסה לשחזר את התוכן
 * מהודעת assistant אחרונה בקו השיווק (נרשמה בשליחה).
 */
export async function fetchRecentZoeAdminOutboundToPhone(studioPhone: string): Promise<string> {
  const phone = String(studioPhone ?? "").trim();
  if (!phone) return "";
  try {
    const { marketingSessionIdVariants } = await import("@/lib/marketing-whatsapp");
    const admin = createSupabaseAdminClient();
    const variants = marketingSessionIdVariants(phone);
    if (!variants.length) return "";
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from("messages")
      .select("content, created_at")
      .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
      .in("session_id", variants)
      .eq("role", "assistant")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(4);
    if (error) {
      console.warn("[wa-zoe-admin-template-log] marketing outbound lookup failed:", error.message);
      return "";
    }
    for (const row of data ?? []) {
      const content = String((row as { content?: string }).content ?? "").trim();
      if (content && !isWaUnsupportedLogContent(content)) return content;
    }
    return "";
  } catch (e) {
    console.warn("[wa-zoe-admin-template-log] marketing outbound lookup exception:", e);
    return "";
  }
}

type HydrateRow = {
  role: string;
  content: string;
  created_at: string;
  error_code?: string | null;
  model_used?: string | null;
};

/**
 * דף שיחות: ממלא `[unsupported]` בשיחה מול מספר זואי לפי הודעות שנרשמו בקו השיווק.
 * IO רק כשיש placeholder בשיחה הזו (שאילתה ממוקדת לפי session).
 */
export async function hydrateUnsupportedZoeAdminMessages(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  slug: string;
  sessionId: string;
  messages: HydrateRow[];
}): Promise<HydrateRow[]> {
  const sessionId = String(input.sessionId ?? "").trim();
  const peerPhone = extractPhoneFromSessionId(sessionId);
  if (!isZoeAdminWhatsAppPhone(peerPhone)) return input.messages;
  if (!input.messages.some((m) => isWaUnsupportedLogContent(m.content))) return input.messages;

  const slug = String(input.slug ?? "").trim().toLowerCase();
  const { data: channels, error: chErr } = await input.admin
    .from("whatsapp_channels")
    .select("phone_display")
    .ilike("business_slug", slug)
    .eq("is_active", true);
  if (chErr) {
    console.warn("[wa-zoe-admin-template-log] hydrate channel lookup failed:", chErr.message);
    return input.messages;
  }

  const { marketingSessionIdVariants } = await import("@/lib/marketing-whatsapp");
  const sessionIds = new Set<string>();
  for (const row of channels ?? []) {
    const display = String((row as { phone_display?: string }).phone_display ?? "").trim();
    for (const sid of marketingSessionIdVariants(display)) sessionIds.add(sid);
  }
  if (!sessionIds.size) return input.messages;

  const { data: outbound, error } = await input.admin
    .from("messages")
    .select("content, created_at")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .in("session_id", [...sessionIds])
    .eq("role", "assistant")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    console.warn("[wa-zoe-admin-template-log] hydrate marketing lookup failed:", error.message);
    return input.messages;
  }

  const outs = (outbound ?? [])
    .map((r) => ({
      content: String((r as { content?: string }).content ?? "").trim(),
      at: Date.parse(String((r as { created_at?: string }).created_at ?? "")),
    }))
    .filter((r) => r.content && !isWaUnsupportedLogContent(r.content) && Number.isFinite(r.at));
  if (!outs.length) return input.messages;

  const used = new Set<number>();
  const WINDOW_MS = 10 * 60 * 1000;
  return input.messages.map((m) => {
    if (!isWaUnsupportedLogContent(m.content)) return m;
    const at = Date.parse(m.created_at);
    if (!Number.isFinite(at)) return m;
    let bestI = -1;
    let bestDist = WINDOW_MS + 1;
    for (let i = 0; i < outs.length; i += 1) {
      if (used.has(i)) continue;
      const dist = Math.abs(outs[i]!.at - at);
      if (dist < bestDist) {
        bestDist = dist;
        bestI = i;
      }
    }
    if (bestI < 0 || bestDist > WINDOW_MS) return m;
    used.add(bestI);
    return {
      ...m,
      content: outs[bestI]!.content,
      model_used: m.model_used || WA_ZOE_ADMIN_TEMPLATE_MODEL,
    };
  });
}
