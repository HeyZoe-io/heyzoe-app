import { getBusinessKnowledgePack } from "@/lib/business-context";
import { formatDateDdMmYyyy } from "@/lib/email";
import { fetchLastSfServiceEventName } from "@/lib/analytics";
import { formatScheduleForOwnerNotification } from "@/lib/notifications/owner-template-params";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";

const NO_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** הודעות ששלחו תפריט חימום (שאלה + כפתורים) — לא תשובות «אחרי בחירה». */
const WARMUP_MENU_SENT_MODELS = new Set([
  "flow_continuation_warmup_experience",
  "flow_continuation_warmup_extra",
  "sales_flow_warmup_extra",
  "sales_flow_warmup_extra_resend",
]);

const WARMUP_BUTTONS_LOG_RE = /\[כפתורים:\s*([^\]]+)\]/u;

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

function normalizeWarmupPickLabel(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseWarmupMenuFromAssistantLog(content: string): { question: string; options: string[] } | null {
  const block = String(content ?? "");
  const buttonsMatch = block.match(WARMUP_BUTTONS_LOG_RE);
  if (!buttonsMatch) return null;

  const options = buttonsMatch[1]!
    .split("|")
    .map((label) => String(label ?? "").trim())
    .filter(Boolean);
  if (options.length < 2) return null;

  const beforeButtons = block.split(WARMUP_BUTTONS_LOG_RE)[0] ?? "";
  const paragraphs = stripAssistantMenuLog(beforeButtons)
    .replace(/\r\n/g, "\n")
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const question = paragraphs[paragraphs.length - 1] ?? "";
  if (!question) return null;

  return { question, options };
}

function userAnswerMatchesWarmupOptions(answer: string, options: string[]): boolean {
  const a = normalizeWarmupPickLabel(answer);
  if (!a || a.length > 200) return false;
  return options.some((opt) => {
    const o = normalizeWarmupPickLabel(opt);
    return o === a || o.includes(a) || a.includes(o);
  });
}

function findWarmupPickAnswerAfterMenu(rows: SessionMsgRow[], menuIndex: number, options: string[]): string {
  for (let j = menuIndex + 1; j < rows.length; j++) {
    const row = rows[j]!;
    if (row.role === "assistant" && WARMUP_MENU_SENT_MODELS.has(row.model_used ?? "")) break;
    if (row.role !== "user") continue;
    const text = String(row.content ?? "").trim();
    if (!text) continue;
    if (userAnswerMatchesWarmupOptions(text, options)) return text;
  }
  return "";
}

function formatWarmupSummaryBlock(questionNumber: number, question: string, answer: string): string {
  return `שאלה ${questionNumber} מתוך סשן חימום (${question})\n${answer}`;
}

/** שאלות חימום + תשובת כפתור שנבחר — מהודעות הסשן בלבד */
export async function buildWarmupSummaryFromSession(input: {
  business_slug: string;
  session_id: string;
}): Promise<string> {
  const rows = await fetchSessionMessagesChronological({ ...input, limit: 120 });
  if (!rows.length) return "";

  const blocks: string[] = [];
  let questionNumber = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.role !== "assistant") continue;
    const model = row.model_used ?? "";
    if (!WARMUP_MENU_SENT_MODELS.has(model)) continue;

    const menu = parseWarmupMenuFromAssistantLog(row.content);
    if (!menu) continue;

    const answer = findWarmupPickAnswerAfterMenu(rows, i, menu.options);
    if (!answer) continue;

    questionNumber += 1;
    blocks.push(formatWarmupSummaryBlock(questionNumber, menu.question, answer));
  }

  return blocks.join("\n\n").slice(0, 900);
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
