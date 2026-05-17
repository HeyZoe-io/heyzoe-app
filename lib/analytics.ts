import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type MessageRole = "user" | "assistant" | "event" | "system";

type MessageLogInput = {
  business_slug: string;
  role: MessageRole;
  content: string;
  model_used?: string | null;
  session_id?: string | null;
  error_code?: string | null;
};

/** מסמן session אחרי בחירת שירות במסלול מכירה (רק role=event — לא נטען ל-Claude). */
export const HEYZOE_SF_SERVICE_PREFIX = "[heyzoe:sf_service]";
/** מסמן התקדמות בשאלות נוספות בסשן חימום (index). */
export const HEYZOE_SF_WARMUP_EXTRA_PREFIX = "[heyzoe:sf_warmup_extra]";
/** נשלחה הודעת CTA (cta_body + כפתורים). */
export const HEYZOE_SF_CTA_REACHED = "[heyzoe:sf_cta_reached]";
/** הלקוח סימן שנרשם לאימון ניסיון (נרשמתי). */
export const HEYZOE_SF_REGISTERED = "[heyzoe:sf_registered]";

export async function fetchLastAssistantModelUsed(input: {
  business_slug: string;
  session_id: string;
}): Promise<string | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("messages")
      .select("model_used")
      .eq("business_slug", input.business_slug)
      .eq("session_id", input.session_id)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || data == null) return null;
    const m = data.model_used;
    return typeof m === "string" && m.trim() ? m.trim() : null;
  } catch {
    return null;
  }
}

export async function fetchLastSfServiceEventName(input: {
  business_slug: string;
  session_id: string;
}): Promise<string | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("messages")
      .select("content")
      .eq("business_slug", input.business_slug)
      .eq("session_id", input.session_id)
      .eq("role", "event")
      .order("created_at", { ascending: false })
      .limit(16);
    if (error || !data?.length) return null;
    for (const row of data) {
      const c = String(row.content ?? "").trim();
      if (!c.startsWith(HEYZOE_SF_SERVICE_PREFIX)) continue;
      const name = c.slice(HEYZOE_SF_SERVICE_PREFIX.length).trim();
      if (name) return name;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchLastSfWarmupExtraIndex(input: {
  business_slug: string;
  session_id: string;
}): Promise<number | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("messages")
      .select("content")
      .eq("business_slug", input.business_slug)
      .eq("session_id", input.session_id)
      .eq("role", "event")
      .order("created_at", { ascending: false })
      .limit(24);
    if (error || !data?.length) return null;
    for (const row of data) {
      const c = String(row.content ?? "").trim();
      if (!c.startsWith(HEYZOE_SF_WARMUP_EXTRA_PREFIX)) continue;
      const raw = c.slice(HEYZOE_SF_WARMUP_EXTRA_PREFIX.length).trim();
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchRecentSessionMessages(input: {
  business_slug: string;
  session_id: string;
  limit?: number;
}): Promise<{ role: "user" | "assistant"; content: string }[]> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("messages")
      .select("role, content")
      .eq("business_slug", input.business_slug)
      .eq("session_id", input.session_id)
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 28);
    if (error || !data?.length) return [];
    const out: { role: "user" | "assistant"; content: string }[] = [];
    for (const row of [...data].reverse()) {
      if (row.role !== "user" && row.role !== "assistant") continue;
      const c = String(row.content ?? "").trim();
      if (!c || c.startsWith("[media]")) continue;
      out.push({ role: row.role, content: c.slice(0, 12_000) });
    }
    return out;
  } catch (e) {
    console.error("[analytics] fetchRecentSessionMessages failed:", e);
    return [];
  }
}

export async function logMessage(input: MessageLogInput) {
  try {
    const supabase = createSupabaseAdminClient();
    const businessSlug = String(input.business_slug ?? "")
      .trim()
      .toLowerCase();
    const { error } = await supabase.from("messages").insert({
      business_slug: businessSlug,
      role: input.role,
      content: input.content,
      model_used: input.model_used ?? null,
      session_id: input.session_id ?? null,
      error_code: input.error_code ?? null,
    });
    if (error) {
      console.error("[analytics] logMessage insert error:", error.message);
    }
  } catch (e) {
    console.error("[analytics] logMessage failed:", e);
  }
}

export async function logConversion(input: {
  business_slug: string;
  session_id?: string | null;
  type?: string;
}) {
  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("conversions").insert({
      business_slug: input.business_slug,
      session_id: input.session_id ?? null,
      type: input.type ?? "cta_click",
    });
    if (error) {
      console.error("[analytics] logConversion insert error:", error.message);
    }
  } catch (e) {
    console.error("[analytics] logConversion failed:", e);
  }
}

export function extractErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return String(status);
  }
  const msg = error instanceof Error ? error.message : String(error);
  const m = msg.match(/\b(429|404|500|502|503|504)\b/);
  return m?.[1] ?? null;
}
