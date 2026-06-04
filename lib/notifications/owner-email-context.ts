import { getBusinessKnowledgePack } from "@/lib/business-context";
import { formatDateDdMmYyyy } from "@/lib/email";
import { fetchLastSfServiceEventName } from "@/lib/analytics";
import { formatScheduleForOwnerNotification } from "@/lib/notifications/owner-template-params";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";

const NO_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

const WARMUP_ASSISTANT_MODELS = new Set([
  "sales_flow_warmup_extra",
  "sales_flow_after_experience",
  "flow_continuation_warmup_extra",
]);

export type IdleLeadRow = {
  full_name: string | null;
  phone: string;
};

export function formatLeadPhoneDisplay(phone: string): string {
  const d = normalizePhone(phone) ?? phone.replace(/\D/g, "");
  if (d.startsWith("972") && d.length >= 12) return `0${d.slice(3)}`;
  return phone.trim() || "—";
}

/** שם + טלפון, או טלפון בלבד אם אין שם */
export function formatLeadIdentityLine(fullName: string | null | undefined, phone: string): string {
  const name = String(fullName ?? "").trim();
  const phoneDisplay = formatLeadPhoneDisplay(phone);
  if (name) return `${name} (${phoneDisplay})`;
  return phoneDisplay;
}

export function formatRegisteredAtHe(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return formatDateDdMmYyyy(iso);
    const date = formatDateDdMmYyyy(d);
    const time = new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return `${date} ${time}`;
  } catch {
    return String(iso ?? "").trim();
  }
}

export function formatScheduleLine(input: {
  requestedDate?: string | null;
  requestedTime?: string | null;
  scheduleDirectRegistration?: boolean;
}): string {
  const line = formatScheduleForOwnerNotification({
    requestedDate: input.requestedDate,
    requestedTime: input.requestedTime,
  });
  if (line) return line;
  if (input.scheduleDirectRegistration === false) return "";
  return "";
}

function stripAssistantMenuLog(text: string): string {
  return String(text ?? "")
    .replace(/\n?\[כפתורים:\s*[^\]]+\]\s*/gu, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function loadContactFullName(
  businessId: number,
  phone: string
): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const normalized = normalizePhone(phone) ?? phone.replace(/\D/g, "");
  const { data } = await admin
    .from("contacts")
    .select("full_name")
    .eq("business_id", businessId)
    .eq("phone", normalized)
    .maybeSingle();
  const name = String((data as { full_name?: string } | null)?.full_name ?? "").trim();
  return name || null;
}

export async function resolveServiceNameForSession(input: {
  businessSlug: string;
  sessionId: string;
  businessId: number;
}): Promise<string> {
  const fromEvent = await fetchLastSfServiceEventName({
    business_slug: input.businessSlug,
    session_id: input.sessionId,
  });
  if (fromEvent?.trim()) return fromEvent.trim();

  const pack = await getBusinessKnowledgePack(input.businessSlug);
  const first = pack?.openingServices?.[0]?.name?.trim();
  return first ?? "";
}

type SessionMsgRow = { role: string; content: string; model_used: string | null };

async function fetchSessionMessagesChronological(input: {
  business_slug: string;
  session_id: string;
  limit?: number;
}): Promise<SessionMsgRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("role, content, model_used")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(input.limit ?? 80);
  if (error || !data?.length) return [];
  return data.map((row) => ({
    role: String((row as { role?: string }).role ?? ""),
    content: String((row as { content?: string }).content ?? "").trim(),
    model_used: String((row as { model_used?: string }).model_used ?? "").trim() || null,
  }));
}

/** שאלות חימום + תשובות ליד מהודעות הסשן */
export async function buildWarmupSummaryFromSession(input: {
  business_slug: string;
  session_id: string;
}): Promise<string> {
  const rows = await fetchSessionMessagesChronological(input);
  if (!rows.length) return "";

  const lines: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.role !== "assistant") continue;
    const model = row.model_used ?? "";
    if (!WARMUP_ASSISTANT_MODELS.has(model)) continue;
    const question = stripAssistantMenuLog(row.content).split("\n")[0]?.trim() ?? "";
    const answer = rows.slice(i + 1).find((r) => r.role === "user")?.content?.trim() ?? "";
    if (!question && !answer) continue;
    if (question && answer) lines.push(`${question} → ${answer}`);
    else if (answer) lines.push(answer);
    else if (question) lines.push(question);
  }

  return lines.join(" | ").slice(0, 900);
}

/** לידים ללא מענה — 24 שעות (כמו daily-no-response-email) */
export async function fetchIdleLeadsLast24h(businessId: number): Promise<IdleLeadRow[]> {
  const admin = createSupabaseAdminClient();
  const sinceIso = new Date(Date.now() - NO_RESPONSE_WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from("contacts")
    .select("full_name, phone")
    .eq("business_id", businessId)
    .eq("source", "whatsapp")
    .not("wa_no_response_at", "is", null)
    .gte("wa_no_response_at", sinceIso)
    .limit(500);

  if (error) {
    if (/wa_no_response_at|column/i.test(String(error.message ?? ""))) {
      console.warn("[owner-email-context] idle leads query skipped:", error.message);
      return [];
    }
    console.warn("[owner-email-context] idle leads query failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    full_name: String((row as { full_name?: string }).full_name ?? "").trim() || null,
    phone: String((row as { phone?: string }).phone ?? "").trim(),
  })).filter((r) => r.phone);
}
