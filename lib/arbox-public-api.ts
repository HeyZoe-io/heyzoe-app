/**
 * Arbox public API (per-business api-key in social_links.arbox_api_key).
 * Base: https://arboxserver.arboxapp.com/api/public
 * Auth: header `api-key: <key>`
 *
 * Query/body field names can be overridden via env if your tenant differs — see server-env.
 */

import { resolveArboxPublicApiBase, resolveArboxScheduleQueryKeys } from "@/lib/server-env";

const FETCH_TIMEOUT_MS = 18_000;

export type ArboxHttpResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string; bodySnippet?: string };

function pickStr(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function unwrapArboxPayload(json: unknown): unknown {
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: unknown }).data;
  }
  return json;
}

function extractItemsFromJson(json: unknown): Record<string, unknown>[] {
  const inner = unwrapArboxPayload(json);
  if (Array.isArray(inner)) {
    return inner.filter((x): x is Record<string, unknown> => x !== null && typeof x === "object") as Record<
      string,
      unknown
    >[];
  }
  if (inner && typeof inner === "object") {
    const o = inner as Record<string, unknown>;
    for (const k of [
      "rows",
      "items",
      "results",
      "records",
      "classes",
      "schedule",
      "data",
      "list",
    ]) {
      const v = o[k];
      const nested = extractItemsFromJson(v);
      if (nested.length) return nested;
    }
  }
  return [];
}

export async function arboxPublicFetch<T = unknown>(
  apiKey: string,
  path: string,
  init?: {
    method?: "GET" | "POST" | "PATCH";
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  }
): Promise<ArboxHttpResult<T>> {
  const key = apiKey.trim();
  if (!key) {
    return { ok: false, status: 0, message: "missing_api_key" };
  }

  const base = resolveArboxPublicApiBase().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  let urlStr = `${base}${p}`;
  if (init?.query) {
    const u = new URL(urlStr);
    for (const [k, v] of Object.entries(init.query)) {
      if (v === undefined) continue;
      u.searchParams.set(k, String(v));
    }
    urlStr = u.toString();
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "api-key": key,
  };
  const method = init?.method ?? "GET";
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(urlStr, {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, message: `network:${msg}` };
  } finally {
    clearTimeout(t);
  }

  const text = await res.text();
  let json: unknown = null;
  if (text && (text.trim().startsWith("{") || text.trim().startsWith("["))) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    let message = `http_${res.status}`;
    if (json && typeof json === "object") {
      const err = (json as { error?: { message?: string }; message?: string }).error?.message;
      const top = (json as { message?: string }).message;
      if (typeof err === "string" && err.trim()) message = err.trim();
      else if (typeof top === "string" && top.trim()) message = top.trim();
    }
    return {
      ok: false,
      status: res.status,
      message,
      bodySnippet: text.slice(0, 400),
    };
  }

  return { ok: true, status: res.status, data: (json ?? (text as unknown)) as T };
}

/** E.164-style for Arbox query params */
export function normalizePhoneForArbox(raw: string): string {
  let s = raw.replace(/^whatsapp:/i, "").replace(/[\s\-()]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("972")) return `+${s}`;
  if (s.startsWith("0")) return `+972${s.slice(1)}`;
  return s;
}

export type ArboxMembershipTier = {
  name: string;
  price: string;
  monthly_sessions: string;
  notes: string;
};

export type ArboxPunchCard = {
  session_count: string;
  validity: string;
  notes: string;
};

function membershipItemToTier(o: Record<string, unknown>): ArboxMembershipTier {
  return {
    name: pickStr(o, [
      "name",
      "title",
      "membershipTypeName",
      "membership_type_name",
      "plan_name",
      "label",
      "membershipName",
    ]),
    price: pickStr(o, [
      "price",
      "price_text",
      "monthly_price",
      "membershipPrice",
      "amount",
      "formatted_price",
      "display_price",
      "priceFormatted",
    ]),
    monthly_sessions: pickStr(o, [
      "monthly_sessions",
      "sessions_per_month",
      "classes_per_month",
      "sessionsAmount",
      "entries_per_month",
      "sessionsPerMonth",
      "numberOfSessions",
    ]),
    notes: pickStr(o, ["notes", "description", "details", "subtitle", "comment"]),
  };
}

function membershipItemToCard(o: Record<string, unknown>): ArboxPunchCard {
  return {
    session_count: pickStr(o, [
      "session_count",
      "sessions",
      "entries",
      "credits",
      "uses",
      "number_of_sessions",
      "sessionsAmount",
    ]),
    validity: pickStr(o, ["validity", "duration", "expiry", "expires_in", "valid_for", "validityDays"]),
    notes: pickStr(o, ["notes", "description", "name", "title", "plan_name"]),
  };
}

function classifyMembershipTypes(items: Record<string, unknown>[]): {
  membership_tiers: ArboxMembershipTier[];
  punch_cards: ArboxPunchCard[];
} {
  const membership_tiers: ArboxMembershipTier[] = [];
  const punch_cards: ArboxPunchCard[] = [];

  for (const o of items) {
    const typeHint = `${pickStr(o, ["type", "plan_type", "category", "kind", "membershipType"])}`.toLowerCase();
    const billing = `${o.billing_cycle ?? o.billing ?? o.interval ?? ""}`.toLowerCase();
    const hasMonthly =
      /month|חודש|recurring|subscription/.test(billing) ||
      Boolean(o.monthly_price || o.price_per_month || o.is_monthly === true);
    const card = membershipItemToCard(o);
    const tier = membershipItemToTier(o);

    const looksPunch =
      /punch|pack|session\s*pack|כרטיס|חביל|multi|מנוי\s*כניסות|card/.test(typeHint) ||
      (Boolean(card.session_count) && !hasMonthly && !tier.price);

    if (looksPunch && (card.session_count || card.validity || card.notes)) {
      punch_cards.push(card);
    } else if (tier.name || tier.price || tier.monthly_sessions || tier.notes) {
      membership_tiers.push(tier);
    } else if (card.session_count || card.validity) {
      punch_cards.push(card);
    }
  }

  return {
    membership_tiers: membership_tiers.slice(0, 32),
    punch_cards: punch_cards.slice(0, 32),
  };
}

export async function arboxFetchMembershipTypes(apiKey: string): Promise<
  | { ok: true; membership_tiers: ArboxMembershipTier[]; punch_cards: ArboxPunchCard[] }
  | { ok: false; message: string; status?: number }
> {
  const res = await arboxPublicFetch(apiKey, "/v3/membershipTypes");
  if (!res.ok) return { ok: false, message: res.message, status: res.status };
  const items = extractItemsFromJson(res.data);
  if (!items.length) {
    return { ok: false, message: "empty_membership_types", status: res.status };
  }
  const { membership_tiers, punch_cards } = classifyMembershipTypes(items);
  if (!membership_tiers.length && !punch_cards.length) {
    return { ok: false, message: "unmapped_membership_types", status: res.status };
  }
  return { ok: true, membership_tiers, punch_cards };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function arboxFetchSchedule(apiKey: string): Promise<
  { ok: true; items: Record<string, unknown>[] } | { ok: false; message: string; status?: number }
> {
  const { fromKey, toKey } = resolveArboxScheduleQueryKeys();
  const from = new Date();
  const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
  const res = await arboxPublicFetch(apiKey, "/v3/schedule", {
    query: {
      [fromKey]: ymd(from),
      [toKey]: ymd(to),
    },
  });
  if (!res.ok) return { ok: false, message: res.message, status: res.status };
  const items = extractItemsFromJson(res.data);
  return { ok: true, items };
}

export async function arboxFetchBoxCategories(apiKey: string): Promise<
  { ok: true; items: Record<string, unknown>[] } | { ok: false; message: string; status?: number }
> {
  const res = await arboxPublicFetch(apiKey, "/v3/schedule/boxCategories");
  if (!res.ok) return { ok: false, message: res.message, status: res.status };
  const items = extractItemsFromJson(res.data);
  return { ok: true, items };
}

function formatScheduleRowHe(o: Record<string, unknown>, i: number): string {
  const title = pickStr(o, [
    "className",
    "class_name",
    "name",
    "title",
    "boxCategoryName",
    "categoryName",
    "sessionName",
    "label",
  ]);
  const start = pickStr(o, [
    "start",
    "startTime",
    "start_time",
    "dateTime",
    "datetime",
    "from",
    "date",
    "scheduleDate",
  ]);
  const end = pickStr(o, ["end", "endTime", "end_time", "to"]);
  const coach = pickStr(o, ["coach", "trainer", "instructor", "teacherName", "staffName"]);
  const spots = pickStr(o, [
    "availableSpots",
    "spotsLeft",
    "spots_left",
    "available",
    "vacancy",
    "remainingPlaces",
  ]);
  const parts = [
    `${i + 1}. ${title || "שיעור"}`,
    start ? `התחלה: ${start}` : "",
    end ? `סיום: ${end}` : "",
    coach ? `מאמן/ת: ${coach}` : "",
    spots ? `מקומות פנויים: ${spots}` : "",
  ].filter(Boolean);
  return parts.join(" | ");
}

export function formatScheduleItemsForPrompt(items: Record<string, unknown>[], maxLines = 35): string {
  if (!items.length) return "אין שיעורים בטווח התאריכים שנמשך מהמערכת (או שהלוח ריק).";
  const lines = items.slice(0, maxLines).map((o, i) => formatScheduleRowHe(o, i)).filter(Boolean);
  const extra = items.length > maxLines ? `\n… ועוד ${items.length - maxLines} רשומות` : "";
  return `${lines.join("\n")}${extra}`;
}

export function formatBoxCategoriesForPrompt(items: Record<string, unknown>[], maxLines = 40): string {
  if (!items.length) return "לא הוגדרו סוגי שירות/קטגוריות מארבוקס.";
  const lines = items.slice(0, maxLines).map((o, i) => {
    const name = pickStr(o, ["name", "title", "label", "boxCategoryName", "categoryName"]);
    const id = pickStr(o, ["id", "fk", "boxCategoryFk"]);
    return `${i + 1}. ${name || "קטגוריה"}${id ? ` (מזהה פנימי: ${id})` : ""}`;
  });
  return lines.join("\n");
}

/** searchUser — try phone query keys from env / defaults */
export async function arboxSearchUserByPhone(
  apiKey: string,
  phone: string
): Promise<ArboxHttpResult<unknown>> {
  const normalized = normalizePhoneForArbox(phone);
  const keys = (process.env.ARBOX_SEARCH_USER_PHONE_PARAMS?.trim() || "phone,mobile,cellPhone,search")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let last: ArboxHttpResult<unknown> = { ok: false, status: 0, message: "no_try" };
  for (const param of keys) {
    const res = await arboxPublicFetch<unknown>(apiKey, "/v3/users/searchUser", {
      query: { [param]: normalized },
    });
    if (res.ok) return res;
    last = res;
  }
  return last;
}

export async function arboxLeadsConverted(apiKey: string, phone: string): Promise<ArboxHttpResult<unknown>> {
  const normalized = normalizePhoneForArbox(phone);
  const param = process.env.ARBOX_LEADS_CONVERTED_PHONE_PARAM?.trim() || "phone";
  return arboxPublicFetch(apiKey, "/v3/leads/converted", { query: { [param]: normalized } });
}

export async function arboxTrialBookingStatus(apiKey: string, phone: string): Promise<ArboxHttpResult<unknown>> {
  const normalized = normalizePhoneForArbox(phone);
  const param = process.env.ARBOX_TRIAL_PHONE_PARAM?.trim() || "phone";
  return arboxPublicFetch(apiKey, "/v3/schedule/booking/trial", { query: { [param]: normalized } });
}

export type ArboxCreateLeadBody = Record<string, unknown>;

export function buildArboxLeadPayload(phone: string, fullName: string): ArboxCreateLeadBody {
  const normalized = normalizePhoneForArbox(phone);
  const envJson = process.env.ARBOX_LEAD_POST_BODY_TEMPLATE?.trim();
  if (envJson) {
    try {
      const tpl = JSON.parse(envJson) as Record<string, unknown>;
      const merged = { ...tpl };
      for (const [k, v] of Object.entries(merged)) {
        if (typeof v === "string") {
          merged[k] = v
            .replace(/\{phone\}/g, normalized)
            .replace(/\{fullName\}/g, fullName.trim())
            .replace(/\{source\}/g, "HeyZoe WhatsApp");
        }
      }
      return merged;
    } catch {
      /* fall through */
    }
  }
  return {
    phone: normalized,
    mobilePhone: normalized,
    fullName: fullName.trim() || undefined,
    firstName: fullName.trim().split(/\s+/)[0] || undefined,
    source: "HeyZoe",
    refererName: "HeyZoe WhatsApp",
    channel: "whatsapp",
  };
}

export async function arboxCreateLead(
  apiKey: string,
  phone: string,
  fullName: string
): Promise<ArboxHttpResult<unknown>> {
  const body = buildArboxLeadPayload(phone, fullName);
  return arboxPublicFetch(apiKey, "/v3/leads", { method: "POST", body });
}

export function summarizeArboxJsonForPrompt(label: string, data: unknown, maxLen = 900): string {
  if (data == null) return `${label}: (ריק)`;
  let s: string;
  try {
    s = typeof data === "string" ? data : JSON.stringify(data);
  } catch {
    s = String(data);
  }
  if (s.length > maxLen) s = `${s.slice(0, maxLen)}…`;
  return `${label}: ${s}`;
}

export async function buildArboxWhatsAppRegistrationSummary(
  apiKey: string,
  phone: string
): Promise<{ lines: string[]; raw: { user: unknown; converted: unknown; trial: unknown } }> {
  const [userRes, convRes, trialRes] = await Promise.all([
    arboxSearchUserByPhone(apiKey, phone),
    arboxLeadsConverted(apiKey, phone),
    arboxTrialBookingStatus(apiKey, phone),
  ]);

  const lines: string[] = [];
  lines.push(
    userRes.ok
      ? summarizeArboxJsonForPrompt("חיפוש משתמש לפי טלפון (Arbox)", userRes.data, 700)
      : `חיפוש משתמש: נכשל (${userRes.message})`
  );
  lines.push(
    convRes.ok
      ? summarizeArboxJsonForPrompt("סטטוס ליד מומר (Arbox)", convRes.data, 500)
      : `ליד מומר: נכשל (${convRes.message})`
  );
  lines.push(
    trialRes.ok
      ? summarizeArboxJsonForPrompt("שריון ניסיון (Arbox)", trialRes.data, 500)
      : `שריון ניסיון: נכשל (${trialRes.message})`
  );

  return {
    lines,
    raw: {
      user: userRes.ok ? userRes.data : null,
      converted: convRes.ok ? convRes.data : null,
      trial: trialRes.ok ? trialRes.data : null,
    },
  };
}
