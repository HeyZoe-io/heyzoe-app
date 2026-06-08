import type { CrmEventKind } from "@/lib/crm/types";
import { formatLeadPhoneDisplay } from "@/lib/notifications/owner-email-context";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/** OpenAPI: https://arboxserver.arboxapp.com/docs/api */
const ARBOX_API_BASE = "https://arboxserver.arboxapp.com/api/public";

type ArboxListResponse = {
  statusCode?: number;
  data?: Record<string, unknown>[];
};

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

function parseLocationId(boxId: string): number | null {
  const n = Number.parseInt(String(boxId ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function splitFullName(fullName: string | null | undefined): { first: string; last: string | null } {
  const parts = String(fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { first: "ליד", last: null };
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

function taskTitleForKind(kind: CrmEventKind): string {
  switch (kind) {
    case "trial_registered":
      return "זואי — רישום לניסיון";
    case "human_requested":
      return "זואי — בקשת נציג";
    case "no_response":
      return "זואי — לא ענה";
  }
}

function defaultTaskReminder(): { date: string; time: string } {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return { date, time: "09:00" };
}

function extractUserId(payload: unknown): string | null {
  const data = (payload as ArboxListResponse | null)?.data;
  if (!Array.isArray(data) || !data.length) return null;
  const row = data[0] ?? {};
  const userId = String(row.user_id ?? row.id ?? "").trim();
  return userId || null;
}

function extractLeadId(payload: unknown): string | null {
  const data = (payload as ArboxListResponse | null)?.data;
  if (!Array.isArray(data) || !data.length) return null;
  const row = data[0] ?? {};
  const leadId = String(row.lead_id ?? "").trim();
  return leadId || null;
}

async function arboxFetch(
  path: string,
  input: { apiKey: string; method?: string; body?: Record<string, unknown> }
): Promise<{ ok: boolean; status: number; json: unknown; rawText: string }> {
  const url = `${ARBOX_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: input.method ?? "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "api-key": input.apiKey,
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
  const rawText = await res.text();
  let json: unknown = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, rawText };
}

async function loadCachedArboxUserId(businessId: number, phone: string): Promise<string | null> {
  const variants = contactPhoneLookupVariants(phone);
  if (!variants.length) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("contacts")
    .select("arbox_user_id")
    .eq("business_id", businessId)
    .in("phone", variants)
    .limit(1)
    .maybeSingle();
  const id = String((data as { arbox_user_id?: string | null } | null)?.arbox_user_id ?? "").trim();
  return id || null;
}

async function cacheArboxIds(input: {
  businessId: number;
  phone: string;
  userId: string;
  leadId?: string | null;
  createdLead?: boolean;
}): Promise<void> {
  const variants = contactPhoneLookupVariants(input.phone);
  if (!variants.length) return;
  const patch: Record<string, unknown> = { arbox_user_id: input.userId };
  if (input.leadId) patch.arbox_lead_id = input.leadId;
  if (input.createdLead) patch.arbox_lead_created_at = new Date().toISOString();

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("contacts")
    .update(patch)
    .eq("business_id", input.businessId)
    .in("phone", variants);
  if (error) {
    console.warn("[crm/arbox] cache ids failed", {
      businessId: input.businessId,
      phone: maskPhoneForLog(input.phone),
      error: error.message,
    });
  }
}

async function searchArboxUserByPhone(input: {
  apiKey: string;
  locationId: number;
  phone: string;
}): Promise<string | null> {
  const phoneDisplay = formatLeadPhoneDisplay(input.phone);
  if (!phoneDisplay || phoneDisplay === "—") return null;

  const qs = new URLSearchParams({
    type: "phone",
    value: phoneDisplay,
    location_id: String(input.locationId),
  });
  const res = await arboxFetch(`/v3/users/searchUser?${qs.toString()}`, {
    apiKey: input.apiKey,
  });

  if (!res.ok) {
    console.error("[crm/arbox] searchUser failed", {
      status: res.status,
      phone: maskPhoneForLog(phoneDisplay),
      body: res.rawText.slice(0, 500),
    });
    return null;
  }

  return extractUserId(res.json);
}

async function createArboxLead(input: {
  apiKey: string;
  locationId: number;
  phone: string;
  fullName?: string | null;
}): Promise<{ userId: string | null; leadId: string | null }> {
  const phoneDisplay = formatLeadPhoneDisplay(input.phone);
  if (!phoneDisplay || phoneDisplay === "—") return { userId: null, leadId: null };

  const { first, last } = splitFullName(input.fullName);
  const body: Record<string, unknown> = {
    first_name: first,
    phone: phoneDisplay,
    location_id: input.locationId,
  };
  if (last) body.last_name = last;

  const res = await arboxFetch("/v3/leads", {
    apiKey: input.apiKey,
    method: "POST",
    body,
  });

  if (!res.ok) {
    console.error("[crm/arbox] create lead failed", {
      status: res.status,
      phone: maskPhoneForLog(phoneDisplay),
      body: res.rawText.slice(0, 500),
    });
    return { userId: null, leadId: null };
  }

  return {
    userId: extractUserId(res.json),
    leadId: extractLeadId(res.json),
  };
}

async function createArboxTask(input: {
  apiKey: string;
  locationId: number;
  userId: string;
  kind: CrmEventKind;
  noteText: string;
}): Promise<boolean> {
  const title = taskTitleForKind(input.kind);
  const description = `${title}\n\n${input.noteText}`.trim();

  const res = await arboxFetch("/v3/tasks", {
    apiKey: input.apiKey,
    method: "POST",
    body: {
      location_id: input.locationId,
      task_type_id: 1,
      user_id: Number.parseInt(input.userId, 10) || input.userId,
      description,
      reminder: defaultTaskReminder(),
    },
  });

  if (!res.ok) {
    console.error("[crm/arbox] create task failed", {
      status: res.status,
      userId: input.userId,
      body: res.rawText.slice(0, 500),
    });
    return false;
  }

  return true;
}

/** Arbox: חיפוש לפי טלפון → יצירת ליד אם חסר → משימה עם הערת זואי. */
export async function submitArboxCrmEvent(input: {
  businessId: number;
  apiKey: string;
  boxId: string;
  phone: string;
  fullName?: string | null;
  noteText: string;
  kind: CrmEventKind;
}): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const noteText = String(input.noteText ?? "").trim();
  const locationId = parseLocationId(boxId);

  if (!apiKey) return { ok: false, error: "missing_api_key" };
  if (!boxId || locationId == null) return { ok: false, error: "missing_or_invalid_box_id" };
  if (!noteText) return { ok: false, error: "missing_note" };

  try {
    let userId = await loadCachedArboxUserId(input.businessId, input.phone);
    let leadId: string | null = null;
    let createdLead = false;

    if (!userId) {
      userId = await searchArboxUserByPhone({ apiKey, locationId, phone: input.phone });
    }

    if (!userId) {
      const created = await createArboxLead({
        apiKey,
        locationId,
        phone: input.phone,
        fullName: input.fullName,
      });
      userId = created.userId;
      leadId = created.leadId;
      createdLead = Boolean(userId);
    }

    if (!userId) {
      return { ok: false, error: "user_not_found_or_created" };
    }

    await cacheArboxIds({
      businessId: input.businessId,
      phone: input.phone,
      userId,
      leadId,
      createdLead,
    });

    const taskOk = await createArboxTask({
      apiKey,
      locationId,
      userId,
      kind: input.kind,
      noteText,
    });

    if (!taskOk) return { ok: false, error: "task_create_failed" };
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[crm/arbox] request failed", {
      businessId: input.businessId,
      phone: maskPhoneForLog(input.phone),
      error: message,
    });
    return { ok: false, error: "request_failed", detail: message };
  }
}
