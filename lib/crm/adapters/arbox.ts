import { extractArboxProfileIdFromLink } from "@/lib/arbox-profile-url";
import type { CrmEventKind } from "@/lib/crm/types";
import { formatLeadPhoneDisplay } from "@/lib/lead-phone-display";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";
import { logArboxPublicFailure, noteArboxCall } from "@/lib/crm/arbox-call-counter-bridge";
import { arboxDailyContext } from "@/lib/leads/arbox-daily-run-flag";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { postArboxTaskWithRetry, recordArboxTaskFailure } from "@/lib/crm/arbox-task-retry";

/** OpenAPI: https://arboxserver.arboxapp.com/docs/api */
export const ARBOX_API_BASE = "https://arboxserver.arboxapp.com/api/public";

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

export type ArboxTaskTypeRow = {
  task_type_id: number;
  task_type_name: string;
};

function isArboxTaskTypeInactive(active: unknown): boolean {
  if (active == null || active === "") return false;
  if (active === false || active === 0) return true;
  const s = String(active).trim().toLowerCase();
  return s === "0" || s === "false" || s === "no" || s === "inactive";
}

/** Parse GET /v3/tasks/types (`TaskTypeResource.data`). */
export function parseArboxTaskTypes(json: unknown): ArboxTaskTypeRow[] {
  const rows = (json as ArboxListResponse | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: ArboxTaskTypeRow[] = [];
  for (const row of rows) {
    if (isArboxTaskTypeInactive(row.active)) continue;
    const id = Number.parseInt(String(row.task_type_id ?? row.id ?? ""), 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    const name = String(row.type ?? row.task_type_name ?? row.name ?? "").trim();
    out.push({ task_type_id: id, task_type_name: name || String(id) });
  }
  out.sort((a, b) => {
    const na = a.task_type_name.localeCompare(b.task_type_name, "he");
    if (na !== 0) return na;
    return a.task_type_id - b.task_type_id;
  });
  return out;
}

export function formatArboxTaskReminder(now: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  const hour = pick("hour").padStart(2, "0");
  const minute = pick("minute").padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

export function buildArboxCreateTaskBody(input: {
  locationId: number;
  taskTypeId: number;
  userId: number;
  description: string;
  now?: Date;
}): Record<string, unknown> {
  return {
    location_id: input.locationId,
    task_type_id: input.taskTypeId,
    user_id: input.userId,
    description: input.description,
    reminder: formatArboxTaskReminder(input.now ?? new Date()),
  };
}

export function shouldCreateArboxHumanRequestTask(
  kind: CrmEventKind,
  taskTypeId: string | null | undefined
): boolean {
  return kind === "human_requested" && parsePositiveIntId(taskTypeId) != null;
}

/** social_links.arbox_trial_task_type_id — empty means no task on a paid trial purchase. */
export function arboxTrialTaskTypeIdFromSocial(social: unknown): string {
  if (!social || typeof social !== "object" || Array.isArray(social)) return "";
  return String((social as Record<string, unknown>).arbox_trial_task_type_id ?? "").trim();
}

/**
 * Paid trial product, after the lead already opened Zoe's sales flow.
 * Walk-in Arbox sales (no sales_flow_started_at) do not open a task.
 */
export function shouldOpenArboxTrialPurchaseTask(input: {
  isTrialProduct: boolean;
  salesFlowStartedAt: string | null | undefined;
  taskTypeId: string | null | undefined;
}): boolean {
  if (!input.isTrialProduct) return false;
  if (!String(input.salesFlowStartedAt ?? "").trim()) return false;
  return parsePositiveIntId(input.taskTypeId) != null;
}

/** ליד חסר בארבוקס: יוצרים ליד גם אם «יצירת לידים» כבויה — רק כדי לשייך משימת בקשת נציג. */
export function shouldCreateArboxLeadForMissingUser(input: {
  leadCreationEnabled: boolean;
  createHumanRequestTask: boolean;
  createLeadIfMissingForTask: boolean;
}): boolean {
  if (input.leadCreationEnabled) return true;
  return input.createHumanRequestTask && input.createLeadIfMissingForTask;
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
    case "idle_no_response":
      return "זואי — ללא מענה 24 שעות";
    case "template_sent":
      return "זואי — טמפלייט פתיחה";
    case "template_no_response":
      return "זואי — לא ענה לטמפלייט";
    case "not_relevant":
      return "זואי — לא רלוונטי";
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

function extractProfileIdFromSearchPayload(payload: unknown): string | null {
  const data = (payload as ArboxListResponse | null)?.data;
  if (!Array.isArray(data) || !data.length) return null;
  const row = data[0] ?? {};
  return extractArboxProfileIdFromLink(row.profile_link);
}

function arboxReportName(pathOrUrl: string): string {
  const path = pathOrUrl.startsWith("http")
    ? pathOrUrl.replace(/^https?:\/\/[^/]+/, "")
    : pathOrUrl;
  const match = path.match(/\/v3\/(?:reports\/)?([^?/]+)/);
  return match?.[1] ?? path.split("?")[0] ?? pathOrUrl;
}

/**
 * GET/POST to Arbox public API (`api-key` header). `pathOrUrl` may be a path or absolute URL (pagination).
 * `timeoutMs` / `signal` are opt-in. With neither, and outside the daily-triggers
 * run context, this is the original fetch (no AbortSignal).
 */
export async function arboxPublicFetch(
  pathOrUrl: string,
  input: {
    apiKey: string;
    method?: string;
    body?: Record<string, unknown>;
    signal?: AbortSignal;
    timeoutMs?: number;
  }
): Promise<{ ok: boolean; status: number; json: unknown; rawText: string }> {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${ARBOX_API_BASE}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
  const started = Date.now();
  noteArboxCall(pathOrUrl);
  const ctx = arboxDailyContext();
  if (ctx) {
    ctx.arboxCalls += 1;
    ctx.arboxReports.push(arboxReportName(pathOrUrl));
  }
  const timeoutMs = input.timeoutMs ?? ctx?.timeoutMs;
  const signal = input.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined);
  let res: Response;
  try {
    res = await fetch(url, {
      method: input.method ?? "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "api-key": input.apiKey,
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal,
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const aborted = name === "AbortError" || name === "TimeoutError";
    logArboxPublicFailure({
      pathOrUrl,
      status: 0,
      json: { message: aborted ? "timeout" : "network" },
      durationMs: Date.now() - started,
    });
    if (!aborted) throw e;
    return { ok: false, status: 0, json: null, rawText: "timeout" };
  }
  const rawText = await res.text();
  let json: unknown = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    logArboxPublicFailure({
      pathOrUrl,
      status: res.status,
      json,
      durationMs: Date.now() - started,
    });
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
  profileId?: string | null;
}): Promise<void> {
  const variants = contactPhoneLookupVariants(input.phone);
  if (!variants.length) return;
  const patch: Record<string, unknown> = { arbox_user_id: input.userId };
  if (input.leadId) patch.arbox_lead_id = input.leadId;
  if (input.createdLead) patch.arbox_lead_created_at = new Date().toISOString();
  const profileId = String(input.profileId ?? "").trim();
  if (profileId) patch.arbox_profile_id = profileId;

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
  const res = await arboxPublicFetch("/v3/locations", { apiKey });
  if (!res.ok) {
    console.error("[crm/arbox] locations fetch failed", {
      status: res.status,
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

export type ArboxUserSearchHit = {
  userId: string | null;
  profileId: string | null;
  fullName: string | null;
};

/** full_name, else first + last, from searchUser data[0]. */
export function fullNameFromArboxSearchPayload(payload: unknown): string | null {
  const data = (payload as ArboxListResponse | null)?.data;
  if (!Array.isArray(data) || !data.length) return null;
  const row = data[0] ?? {};
  const full = String(row.full_name ?? "").trim();
  if (full) return full;
  const combined = [row.first_name, row.last_name]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return combined || null;
}

/**
 * GET /v3/users/searchUser. `searchValue` skips display formatting (backfill uses 972…).
 * extractUserId behavior is unchanged: user_id ?? id from data[0].
 */
export async function lookupArboxUserByPhone(input: {
  apiKey: string;
  locationId?: number;
  phone: string;
  searchValue?: string;
}): Promise<ArboxUserSearchHit> {
  const empty: ArboxUserSearchHit = { userId: null, profileId: null, fullName: null };
  const phoneDisplay = String(input.searchValue ?? "").trim() || formatLeadPhoneDisplay(input.phone);
  if (!phoneDisplay || phoneDisplay === "—") return empty;

  const trySearch = async (locationId?: number): Promise<ArboxUserSearchHit> => {
    const qs = new URLSearchParams({ type: "phone", value: phoneDisplay });
    if (locationId != null) qs.set("location_id", String(locationId));
    const res = await arboxPublicFetch(`/v3/users/searchUser?${qs.toString()}`, {
      apiKey: input.apiKey,
    });

    if (!res.ok) {
      console.error("[crm/arbox] searchUser failed", {
        status: res.status,
        phone: maskPhoneForLog(phoneDisplay),
        locationId: locationId ?? null,
      });
      return empty;
    }

    return {
      userId: extractUserId(res.json),
      profileId: extractProfileIdFromSearchPayload(res.json),
      fullName: fullNameFromArboxSearchPayload(res.json),
    };
  };

  const withLocation = await trySearch(input.locationId);
  if (withLocation.userId) return withLocation;
  if (input.locationId != null) return trySearch(undefined);
  return withLocation;
}

export async function searchArboxUserByPhone(input: {
  apiKey: string;
  locationId?: number;
  phone: string;
}): Promise<string | null> {
  const hit = await lookupArboxUserByPhone(input);
  return hit.userId;
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
  };
  const comment = ARBOX_CRM_NOTE_WRITES_ENABLED ? input.noteText.trim() : "";
  if (comment) body.comment = comment;
  if (last) body.last_name = last;
  if (input.sourceId != null) body.source_id = input.sourceId;
  if (input.statusId != null) body.status_id = input.statusId;

  console.info("[crm/arbox] create lead", {
    phone: maskPhoneForLog(phoneDisplay),
    locationId: input.locationId,
    sourceId: input.sourceId ?? null,
    statusId: input.statusId ?? null,
    hasComment: Boolean(comment),
  });

  const res = await arboxPublicFetch("/v3/leads", {
    apiKey: input.apiKey,
    method: "POST",
    body,
  });

  if (!res.ok) {
    console.error("[crm/arbox] create lead failed", {
      status: res.status,
      phone: maskPhoneForLog(phoneDisplay),
    });
    return { userId: null, leadId: null };
  }

  const userId = extractUserId(res.json);
  const leadId = extractLeadId(res.json);
  if (!userId) {
    console.warn("[crm/arbox] create lead ok but no user_id in response", {
      phone: maskPhoneForLog(phoneDisplay),
    });
  }

  return { userId, leadId };
}

function buildArboxNoteDescription(kind: CrmEventKind, noteText: string): string {
  return `${notePrefixForKind(kind)}\n\n${noteText}`.trim();
}

/**
 * Zoe no longer writes client-card notes. The same events still update the
 * HeyZoe contact and still open an Arbox task when one is configured.
 * Existing Arbox notes are left as they are.
 */
export const ARBOX_CRM_NOTE_WRITES_ENABLED = false;

async function appendArboxNote(input: {
  apiKey: string;
  userId: string;
  kind: CrmEventKind;
  noteText: string;
}): Promise<boolean> {
  if (!ARBOX_CRM_NOTE_WRITES_ENABLED) {
    console.info("[crm/arbox] note write skipped", {
      userId: input.userId,
      kind: input.kind,
    });
    return true;
  }

  const description = buildArboxNoteDescription(input.kind, input.noteText);
  const userIdNum = Number.parseInt(input.userId, 10);
  if (!Number.isFinite(userIdNum) || userIdNum <= 0) {
    console.error("[crm/arbox] create note failed — invalid user_id", { userId: input.userId });
    return false;
  }

  const noteBody = { user_id: userIdNum, description };

  // לידים — עדיף leads/createNote; users/createNote מחזיר 500 לחלק מלידים חדשים.
  const leadNoteRes = await arboxPublicFetch("/v3/leads/createNote", {
    apiKey: input.apiKey,
    method: "POST",
    body: noteBody,
  });
  if (leadNoteRes.ok) return true;

  console.warn("[crm/arbox] leads/createNote failed, trying users/createNote", {
    status: leadNoteRes.status,
    userId: input.userId,
  });

  const userNoteRes = await arboxPublicFetch("/v3/users/createNote", {
    apiKey: input.apiKey,
    method: "POST",
    body: noteBody,
  });
  if (userNoteRes.ok) return true;

  console.error("[crm/arbox] create note failed", {
    status: userNoteRes.status,
    userId: input.userId,
  });
  return false;
}

async function createArboxTask(input: {
  apiKey: string;
  locationId: number;
  taskTypeId: number;
  userId: string;
  kind: CrmEventKind;
  noteText: string;
  businessId?: number | null;
}): Promise<boolean> {
  const userIdNum = Number.parseInt(input.userId, 10);
  if (!Number.isFinite(userIdNum) || userIdNum <= 0) {
    console.error("[crm/arbox] create task failed — invalid user_id", { userId: input.userId });
    return false;
  }

  const body = buildArboxCreateTaskBody({
    locationId: input.locationId,
    taskTypeId: input.taskTypeId,
    userId: userIdNum,
    description: buildArboxNoteDescription(input.kind, input.noteText),
  });

  // קריאה אחת ל-Arbox לכל בקשת נציג (לא Claude/Meta); עד 2 ניסיונות נוספים רק אחרי 5xx / 429 / רשת.
  const res = await postArboxTaskWithRetry(() =>
    arboxPublicFetch("/v3/tasks", {
      apiKey: input.apiKey,
      method: "POST",
      body,
    })
  );
  if (res.ok) return true;

  console.error("[crm/arbox] create task failed", {
    status: res.status,
    attempts: res.attempts,
    businessId: input.businessId ?? null,
    userId: input.userId,
    taskTypeId: input.taskTypeId,
  });
  await recordArboxTaskFailure({
    businessId: input.businessId ?? null,
    userId: input.userId,
    taskTypeId: input.taskTypeId,
    kind: input.kind,
    status: res.status,
    attempts: res.attempts,
  });
  return false;
}

/** One Arbox locations GET + one POST /v3/tasks. Used for a paid trial purchase, not per message. */
export async function createArboxCrmTask(input: {
  apiKey: string;
  boxId: string;
  taskTypeId: number;
  userId: string;
  kind: CrmEventKind;
  noteText: string;
  businessId?: number | null;
}): Promise<boolean> {
  const apiKey = String(input.apiKey ?? "").trim();
  const taskTypeId = input.taskTypeId;
  if (!apiKey || !Number.isFinite(taskTypeId) || taskTypeId <= 0) return false;
  const locationResolved = await resolveArboxLocationId(apiKey, input.boxId);
  if (!locationResolved.ok) {
    console.error("[crm/arbox] create task failed — location", {
      error: locationResolved.error,
      detail: locationResolved.detail,
    });
    return false;
  }
  return createArboxTask({
    apiKey,
    locationId: locationResolved.locationId,
    taskTypeId,
    userId: input.userId,
    kind: input.kind,
    noteText: input.noteText,
    businessId: input.businessId ?? null,
  });
}

/** Arbox: חיפוש לפי טלפון → יצירת ליד אם חסר → הערה, או משימה בבקשת נציג אם הוגדר סוג. */
export async function submitArboxCrmEvent(input: {
  businessId: number;
  apiKey: string;
  boxId: string;
  sourceId?: string | null;
  statusId?: string | null;
  humanRequestTaskTypeId?: string | null;
  leadCreationEnabled?: boolean;
  /** false = אל תיצרי ליד חדש (למשל כבר נרשם לניסיון). */
  createLeadIfMissingForTask?: boolean;
  phone: string;
  fullName?: string | null;
  noteText: string;
  kind: CrmEventKind;
}): Promise<{ ok: true; createdHumanRequestTask: boolean } | { ok: false; error: string; detail?: string }> {
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
  const humanRequestTaskTypeId = parsePositiveIntId(input.humanRequestTaskTypeId);
  const createHumanRequestTask = shouldCreateArboxHumanRequestTask(
    input.kind,
    input.humanRequestTaskTypeId
  );

  try {
    let userId = await loadCachedArboxUserId(input.businessId, input.phone);
    let profileId: string | null = null;
    let leadId: string | null = null;
    let createdLead = false;

    if (!userId) {
      const found = await lookupArboxUserByPhone({ apiKey, locationId, phone: input.phone });
      userId = found.userId;
      profileId = found.profileId;
    }

    if (!userId) {
      const createLead = shouldCreateArboxLeadForMissingUser({
        leadCreationEnabled: input.leadCreationEnabled === true,
        createHumanRequestTask,
        createLeadIfMissingForTask: input.createLeadIfMissingForTask !== false,
      });
      if (!createLead) {
        return { ok: true, createdHumanRequestTask: false };
      }
      const created = await createArboxLead({
        apiKey,
        locationId,
        phone: input.phone,
        fullName: input.fullName,
        sourceId,
        statusId,
        noteText: buildArboxNoteDescription(input.kind, noteText),
      });
      userId = created.userId;
      leadId = created.leadId;
      createdLead = Boolean(userId);
    }

    if (!userId) {
      const found = await lookupArboxUserByPhone({ apiKey, locationId, phone: input.phone });
      userId = found.userId;
      if (found.profileId) profileId = found.profileId;
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
      profileId,
    });

    if (createdLead && !createHumanRequestTask) {
      return { ok: true, createdHumanRequestTask: false };
    }

    if (createHumanRequestTask && humanRequestTaskTypeId != null) {
      const taskOk = await createArboxTask({
        apiKey,
        locationId,
        taskTypeId: humanRequestTaskTypeId,
        userId,
        kind: input.kind,
        noteText,
        businessId: input.businessId,
      });
      if (taskOk) return { ok: true, createdHumanRequestTask: true };
      if (createdLead) {
        return { ok: false, error: "task_create_failed" };
      }
      console.warn("[crm/arbox] task create failed — falling back to note", {
        businessId: input.businessId,
        phone: maskPhoneForLog(input.phone),
      });
    }

    if (createdLead) {
      return { ok: true, createdHumanRequestTask: false };
    }

    const noteOk = await appendArboxNote({
      apiKey,
      userId,
      kind: input.kind,
      noteText,
    });

    if (!noteOk) {
      return { ok: false, error: "note_create_failed" };
    }
    return { ok: true, createdHumanRequestTask: false };
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
