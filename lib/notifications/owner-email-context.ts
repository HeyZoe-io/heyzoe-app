import { getBusinessKnowledgePack } from "@/lib/business-context";
import { formatDateDdMmYyyy } from "@/lib/email";
import { fetchLastSfServiceEventName } from "@/lib/analytics";
import { formatScheduleForOwnerNotification } from "@/lib/notifications/owner-template-params";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone-normalize";
import { truncateWaButtonLabel } from "@/lib/wa-button-label";
import { metaInteractiveDecodeReplyId } from "@/lib/whatsapp";

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

type SessionMsgRow = {
  role: string;
  content: string;
  model_used: string | null;
  created_at: string;
};

const REGISTERED_USER_REPLY_RE = /^(נרשמתי|נרשמת|נרשמנו|registered)\b/iu;

async function fetchWarmupMenuAssistantRows(input: {
  business_slug: string;
  session_id: string;
}): Promise<SessionMsgRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("role, content, model_used, created_at")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
    .eq("role", "assistant")
    .in("model_used", [...WARMUP_MENU_SENT_MODELS])
    .order("created_at", { ascending: true })
    .limit(40);
  if (error || !data?.length) return [];
  return data.map((row) => ({
    role: "assistant",
    content: String((row as { content?: string }).content ?? "").trim(),
    model_used: String((row as { model_used?: string }).model_used ?? "").trim() || null,
    created_at: String((row as { created_at?: string }).created_at ?? ""),
  }));
}

async function fetchUserMessagesChronological(input: {
  business_slug: string;
  session_id: string;
}): Promise<SessionMsgRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("messages")
    .select("role, content, model_used, created_at")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(300);
  if (error || !data?.length) return [];
  return data.map((row) => ({
    role: "user",
    content: String((row as { content?: string }).content ?? "").trim(),
    model_used: null,
    created_at: String((row as { created_at?: string }).created_at ?? ""),
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

function warmupLabelsMatch(a: string, b: string): boolean {
  return normalizeWarmupPickLabel(a) === normalizeWarmupPickLabel(b);
}

/** מיפוי תשובת ליד לתווית כפתור (כולל «1», id מקודד z:, חיתוך 23 תווים). */
function resolveWarmupUserPick(raw: string, options: string[]): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || REGISTERED_USER_REPLY_RE.test(trimmed)) return "";

  const decodedFromText = metaInteractiveDecodeReplyId(trimmed);
  const candidates = [decodedFromText, trimmed].filter((x): x is string => Boolean(x?.length));

  if (/^[1-9]$/.test(trimmed)) {
    const idx = Number(trimmed) - 1;
    if (idx >= 0 && idx < options.length) return options[idx]!.trim();
  }

  for (const c of candidates) {
    if (/^[1-9]$/.test(c)) {
      const idx = Number(c) - 1;
      if (idx >= 0 && idx < options.length) return options[idx]!.trim();
    }
    const exact = options.find((opt) => warmupLabelsMatch(opt, c));
    if (exact) return exact.trim();
    const trunc = options.find(
      (opt) =>
        warmupLabelsMatch(truncateWaButtonLabel(opt), c) ||
        warmupLabelsMatch(opt, truncateWaButtonLabel(c))
    );
    if (trunc) return trunc.trim();
    const foldHit = options.find((opt) => {
      const o = normalizeWarmupPickLabel(opt);
      const a = normalizeWarmupPickLabel(c);
      return o === a || (o.length >= 8 && a.length >= 8 && (o.includes(a) || a.includes(o)));
    });
    if (foldHit) return foldHit.trim();
  }

  return "";
}

function findWarmupPickInUserWindow(
  userRows: SessionMsgRow[],
  afterIso: string,
  beforeIso: string | null,
  options: string[]
): string {
  for (const row of userRows) {
    if (!row.created_at || row.created_at <= afterIso) continue;
    if (beforeIso && row.created_at >= beforeIso) continue;
    const text = String(row.content ?? "").trim();
    if (!text || REGISTERED_USER_REPLY_RE.test(text)) continue;
    const resolved = resolveWarmupUserPick(text, options);
    if (resolved) return resolved;
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
  const [menuRows, userRows] = await Promise.all([
    fetchWarmupMenuAssistantRows(input),
    fetchUserMessagesChronological(input),
  ]);
  if (!menuRows.length) return "";

  const blocks: string[] = [];
  let questionNumber = 0;

  for (let i = 0; i < menuRows.length; i++) {
    const row = menuRows[i]!;
    const menu = parseWarmupMenuFromAssistantLog(row.content);
    if (!menu || !row.created_at) continue;

    const nextMenuAt = menuRows[i + 1]?.created_at ?? null;
    const answer = findWarmupPickInUserWindow(userRows, row.created_at, nextMenuAt, menu.options);
    if (!answer) {
      console.info("[buildWarmupSummaryFromSession] no pick for menu", {
        business_slug: input.business_slug,
        session_id: input.session_id,
        model: row.model_used,
        options: menu.options.slice(0, 4),
      });
      continue;
    }

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
