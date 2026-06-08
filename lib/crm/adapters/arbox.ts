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

type ArboxLocation = { id: number; name: string };

function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `***${d.slice(-4)}`;
}

function parsePositiveIntId(value: string | null | undefined): number | null {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseLocationId(boxId: string): number | null {
  return parsePositiveIntId(boxId);
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

function notePrefixForKind(kind: CrmEventKind): string {
  switch (kind) {
    case "trial_registered":
      return "זואי — רישום לניסיון";
    case "human_requested":
      return "זואי — בקשת נציג";
    case "no_response":
      return "זואי — לא ענה";
  }
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

async function fetchArboxLocations(apiKey: string): Promise<ArboxLocation[]> {
  const res = await arboxFetch("/v3/locations", { apiKey });
  if (!res.ok) {
    console.error("[crm/arbox] locations fetch failed", {
      status: res.status,
      body: res.rawText.slice(0, 500),
    });
    return [];
  }
  const data = (res.json as ArboxListResponse | null)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      const id = Number.parseInt(String(row.location_id ?? ""), 10);
      const name = String(row.location_name ?? "").trim();
      return Number.isFinite(id) && id > 0 ? { id, name } : null;
    })
    .filter((row): row is ArboxLocation => row != null);
}

async function resolveArboxLocationId(
  apiKey: string,
  configuredBoxId: string
): Promise<{ ok: true; locationId: number } | { ok: false; error: string; detail?: string }> {
  const locations = await fetchArboxLocations(apiKey);
  if (!locations.length) {
    return {
      ok: false,
      error: "no_locations_found",
      detail: "Arbox returned no locations for this API key",
    };
  }

  const configured = parseLocationId(configuredBoxId);
  if (configured != null) {
    const match = locations.find((l) => l.id === configured);
    if (match) return { ok: true, locationId: match.id };
    console.warn("[crm/arbox] configured location_id invalid", {
      configured: configuredBoxId,
      available: locations.map((l) => l.id),
    });
  }

  if (locations.length === 1) {
    return { ok: true, locationId: locations[0]!.id };
  }

  const ids = locations.map((l) => `${l.id}${l.name ? ` (${l.name})` : ""}`).join(", ");
  return {
    ok: false,
    error: "invalid_or_ambiguous_location_id",
    detail: `Set location id to one of: ${ids}`,
  };
}

async function searchArboxUserByPhone(input: {
  apiKey: string;
  locationId?: number;
  phone: string;
}): Promise<string | null> {
  const phoneDisplay = formatLeadPhoneDisplay(input.phone);
  if (!phoneDisplay || phoneDisplay === "—") return null;

  const trySearch = async (locationId?: number): Promise<string | null> => {
    const qs = new URLSearchParams({ type: "phone", value: phoneDisplay });
    if (locationId != null) qs.set("location_id", String(locationId));
    const res = await arboxFetch(`/v3/users/searchUser?${qs.toString()}`, {
      apiKey: input.apiKey,
    });

    if (!res.ok) {
      console.error("[crm/arbox] searchUser failed", {
        status: res.status,
        phone: maskPhoneForLog(phoneDisplay),
        locationId: locationId ?? null,
        body: res.rawText.slice(0, 500),
      });
      return null;
    }

    return extractUserId(res.json);
  };

  const withLocation = await trySearch(input.locationId);
  if (withLocation) return withLocation;
  if (input.locationId != null) return trySearch(undefined);
  return null;
}

async function createArboxLead(input: {
  apiKey: string;
  locationId: number;
  phone: string;
  fullName?: string | null;
  sourceId?: number | null;
  statusId?: number | null;
  noteText: string;
}): Promise<{ userId: string | null; leadId: string | null }> {
  const phoneDisplay = formatLeadPhoneDisplay(input.phone);
  if (!phoneDisplay || phoneDisplay === "—") return { userId: null, leadId: null };

  const { first, last } = splitFullName(input.fullName);
  const body: Record<string, unknown> = {
    first_name: first,
    phone: phoneDisplay,
    location_id: input.locationId,
    comment: input.noteText.trim(),
  };
  if (last) body.last_name = last;
  if (input.sourceId != null) body.source_id = input.sourceId;
  if (input.statusId != null) body.status_id = input.statusId;

  console.info("[crm/arbox] create lead", {
    phone: maskPhoneForLog(phoneDisplay),
    locationId: input.locationId,
    sourceId: input.sourceId ?? null,
    statusId: input.statusId ?? null,
    hasComment: Boolean(input.noteText.trim()),
  });

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

  const userId = extractUserId(res.json);
  const leadId = extractLeadId(res.json);
  if (!userId) {
    console.warn("[crm/arbox] create lead ok but no user_id in response", {
      phone: maskPhoneForLog(phoneDisplay),
      body: res.rawText.slice(0, 500),
    });
  }

  return { userId, leadId };
}

function buildArboxNoteDescription(kind: CrmEventKind, noteText: string): string {
  return `${notePrefixForKind(kind)}\n\n${noteText}`.trim();
}

async function appendArboxNote(input: {
  apiKey: string;
  userId: string;
  kind: CrmEventKind;
  noteText: string;
  statusId?: number | null;
}): Promise<boolean> {
  const description = buildArboxNoteDescription(input.kind, input.noteText);
  const userIdNum = Number.parseInt(input.userId, 10);
  if (!Number.isFinite(userIdNum) || userIdNum <= 0) {
    console.error("[crm/arbox] create note failed — invalid user_id", { userId: input.userId });
    return false;
  }

  const noteBody = { user_id: userIdNum, description };

  // לידים — עדיף leads/createNote; users/createNote מחזיר 500 לחלק מלידים חדשים.
  const leadNoteRes = await arboxFetch("/v3/leads/createNote", {
    apiKey: input.apiKey,
    method: "POST",
    body: noteBody,
  });
  if (leadNoteRes.ok) return true;

  console.warn("[crm/arbox] leads/createNote failed, trying users/createNote", {
    status: leadNoteRes.status,
    userId: input.userId,
    body: leadNoteRes.rawText.slice(0, 500),
  });

  const userNoteRes = await arboxFetch("/v3/users/createNote", {
    apiKey: input.apiKey,
    method: "POST",
    body: noteBody,
  });
  if (userNoteRes.ok) return true;

  if (input.statusId != null) {
    const statusRes = await arboxFetch("/v3/leads/updateStatus", {
      apiKey: input.apiKey,
      method: "POST",
      body: {
        user_id: userIdNum,
        status_id: input.statusId,
        comment: description,
      },
    });
    if (statusRes.ok) return true;
    console.error("[crm/arbox] leads/updateStatus note fallback failed", {
      status: statusRes.status,
      userId: input.userId,
      body: statusRes.rawText.slice(0, 500),
    });
  }

  console.error("[crm/arbox] create note failed", {
    status: userNoteRes.status,
    userId: input.userId,
    body: userNoteRes.rawText.slice(0, 500),
  });
  return false;
}

/** Arbox: חיפוש לפי טלפון → יצירת ליד אם חסר → משימה עם הערת זואי. */
export async function submitArboxCrmEvent(input: {
  businessId: number;
  apiKey: string;
  boxId: string;
  sourceId?: string | null;
  statusId?: string | null;
  phone: string;
  fullName?: string | null;
  noteText: string;
  kind: CrmEventKind;
}): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const apiKey = String(input.apiKey ?? "").trim();
  const boxId = String(input.boxId ?? "").trim();
  const noteText = String(input.noteText ?? "").trim();

  if (!apiKey) return { ok: false, error: "missing_api_key" };
  if (!noteText) return { ok: false, error: "missing_note" };

  const locationResolved = await resolveArboxLocationId(apiKey, boxId);
  if (!locationResolved.ok) {
    return { ok: false, error: locationResolved.error, detail: locationResolved.detail };
  }
  const locationId = locationResolved.locationId;
  const sourceId = parsePositiveIntId(input.sourceId);
  const statusId = parsePositiveIntId(input.statusId);

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
        sourceId,
        statusId,
        noteText,
      });
      userId = created.userId;
      leadId = created.leadId;
      createdLead = Boolean(userId);
    }

    if (!userId) {
      userId = await searchArboxUserByPhone({ apiKey, locationId, phone: input.phone });
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

    const noteOk = await appendArboxNote({
      apiKey,
      userId,
      kind: input.kind,
      noteText,
      statusId,
    });

    if (!noteOk) {
      if (createdLead) {
        console.warn("[crm/arbox] note failed after lead create; lead exists without activity note", {
          businessId: input.businessId,
          phone: maskPhoneForLog(input.phone),
          userId,
        });
      }
      return { ok: false, error: "note_create_failed" };
    }
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
