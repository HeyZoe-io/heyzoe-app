import { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import { businessHasArboxConnection } from "@/lib/crm/types";
import type { ProductScheduleSlot } from "@/lib/product-schedule-slots";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

const IL_TZ = "Asia/Jerusalem";
const HEBREW_DAY_BY_SUNDAY_INDEX = ["א", "ב", "ג", "ד", "ה", "ו", "ש"] as const;
const MAX_SCHEDULE_PAGES = 20;
/** Inclusive rolling week: today through +6 = 7 calendar days, each weekday once. */
const WINDOW_DAYS = 6;

export type ArboxScheduleRemovedNotice = {
  detected_at: string;
  dismissed: boolean;
};

export type ArboxClassStamp = {
  arbox_box_category_id: number | null;
  arbox_class_name: string;
  schedule_removed_notice: ArboxScheduleRemovedNotice | null;
};

export type ArboxWeeklyClass = {
  session_name: string;
  box_category_id: number | null;
  slots: Array<{ day: string; time: string }>;
};

export type ArboxBoxCategoryCatalog = {
  ids: Set<number>;
  names: Set<string>;
  nameToId: Map<string, number>;
  fetchFailed: boolean;
};

export type ServiceDescriptionBlob = Record<string, unknown>;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type ServiceRow = {
  id: number;
  name: string;
  description: string | null;
  service_slug: string;
  sort_order: number | null;
  location_mode?: string | null;
  location_text?: string | null;
  price_text?: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function israelYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDaysYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function hebrewDayLetterFromYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd).trim());
  if (!m) return "";
  const utcNoon = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: IL_TZ,
    weekday: "short",
  }).format(utcNoon);
  const idx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday];
  return idx == null ? "" : HEBREW_DAY_BY_SUNDAY_INDEX[idx]!;
}

export function normalizeHhmm(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(min) || min < 0 || min > 59) {
    return "";
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseServiceDescriptionObject(raw: string): ServiceDescriptionBlob {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return {};
  const candidate = trimmed.startsWith("__META__:") ? trimmed.slice("__META__:".length).trim() : trimmed;
  if (!candidate.startsWith("{")) return { description_text: trimmed };
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...(parsed as ServiceDescriptionBlob) };
    }
  } catch {
    /* fall through */
  }
  return { description_text: trimmed };
}

export function mergeServiceDescriptionPatch(raw: string, patch: ServiceDescriptionBlob): string {
  return JSON.stringify({ ...parseServiceDescriptionObject(raw), ...patch });
}

export function parseArboxClassStamp(meta: ServiceDescriptionBlob): ArboxClassStamp {
  const idRaw = meta.arbox_box_category_id;
  const idNum = typeof idRaw === "number" ? idRaw : Number.parseInt(String(idRaw ?? "").trim(), 10);
  const arbox_box_category_id = Number.isFinite(idNum) && idNum > 0 ? idNum : null;
  const arbox_class_name = String(meta.arbox_class_name ?? "").trim();
  const noticeRaw = asRecord(meta.schedule_removed_notice);
  let schedule_removed_notice: ArboxScheduleRemovedNotice | null = null;
  if (noticeRaw) {
    const detected_at = String(noticeRaw.detected_at ?? "").trim();
    if (detected_at) {
      schedule_removed_notice = { detected_at, dismissed: noticeRaw.dismissed === true };
    }
  }
  return { arbox_box_category_id, arbox_class_name, schedule_removed_notice };
}

export function arboxClassMatchKey(stamp: {
  box_category_id?: number | null;
  arbox_box_category_id?: number | null;
  session_name?: string;
  arbox_class_name?: string;
}): string | null {
  const id = stamp.arbox_box_category_id ?? stamp.box_category_id ?? null;
  if (id != null && id > 0) return `id:${id}`;
  const name = String(stamp.arbox_class_name ?? stamp.session_name ?? "").trim();
  if (name) return `name:${name}`;
  return null;
}

export function isArboxManagedStamp(stamp: ArboxClassStamp): boolean {
  return arboxClassMatchKey(stamp) != null;
}

export function indexWeeklyClassesByMatchKey(classes: ArboxWeeklyClass[]): Map<string, ArboxWeeklyClass> {
  const classByKey = new Map<string, ArboxWeeklyClass>();
  for (const cls of classes) {
    const idKey = arboxClassMatchKey({
      box_category_id: cls.box_category_id,
      session_name: cls.session_name,
    });
    const nameKey = arboxClassMatchKey({ session_name: cls.session_name });
    if (idKey && !classByKey.has(idKey)) classByKey.set(idKey, cls);
    if (nameKey && !classByKey.has(nameKey)) classByKey.set(nameKey, cls);
  }
  return classByKey;
}

export function findWeeklyClassForStamp(
  classByKey: Map<string, ArboxWeeklyClass>,
  stamp: { arbox_box_category_id?: number | null; arbox_class_name?: string; box_category_id?: number | null; session_name?: string }
): ArboxWeeklyClass | undefined {
  const key = arboxClassMatchKey(stamp);
  if (key && classByKey.has(key)) return classByKey.get(key);
  const nameKey = arboxClassMatchKey({
    arbox_class_name: stamp.arbox_class_name,
    session_name: stamp.session_name,
  });
  if (nameKey && nameKey !== key) return classByKey.get(nameKey);
  return undefined;
}

export function weeklySlotsFromOccurrences(
  occurrences: Array<{ date: string; start_time: string }>
): Array<{ day: string; time: string }> {
  const seen = new Set<string>();
  const out: Array<{ day: string; time: string }> = [];
  for (const occ of occurrences) {
    const day = hebrewDayLetterFromYmd(occ.date);
    const time = normalizeHhmm(occ.start_time);
    if (!day || !time) continue;
    const k = `${day}|${time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ day, time });
  }
  return out;
}

export function slotsToProductScheduleSlots(
  slots: Array<{ day: string; time: string }>,
  newId: () => string
): ProductScheduleSlot[] {
  return slots.map((s) => ({ id: newId(), day: s.day, time: s.time }));
}

export function shouldNotifyRemovedClass(input: {
  stamp: ArboxClassStamp;
  catalog: ArboxBoxCategoryCatalog;
}): boolean {
  if (input.catalog.fetchFailed) return false;
  if (input.stamp.arbox_box_category_id != null) {
    return !input.catalog.ids.has(input.stamp.arbox_box_category_id);
  }
  const name = input.stamp.arbox_class_name.trim();
  if (!name) return false;
  return !input.catalog.names.has(name);
}

function extractRows(json: unknown): Record<string, unknown>[] {
  const rec = asRecord(json);
  const data = rec?.data;
  if (!Array.isArray(data)) return [];
  return data.filter((r): r is Record<string, unknown> => Boolean(asRecord(r)));
}

function nextPageUrl(json: unknown): string | null {
  const rec = asRecord(json);
  const extra = asRecord(rec?.extra);
  const pagination = asRecord(extra?.pagination);
  const url = String(pagination?.next_page_url ?? extra?.next_page_url ?? "").trim();
  return url || null;
}

async function fetchPaginatedArboxList(input: {
  apiKey: string;
  firstPath: string;
}): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; status: number; body: string }> {
  const rows: Record<string, unknown>[] = [];
  let pathOrUrl: string | null = input.firstPath;
  let pages = 0;
  while (pathOrUrl && pages < MAX_SCHEDULE_PAGES) {
    pages += 1;
    const res = await arboxPublicFetch(pathOrUrl, { apiKey: input.apiKey, method: "GET" });
    if (!res.ok) {
      return { ok: false, status: res.status, body: res.rawText.slice(0, 400) };
    }
    rows.push(...extractRows(res.json));
    pathOrUrl = nextPageUrl(res.json);
  }
  return { ok: true, rows };
}

export async function fetchArboxScheduleOccurrences(input: {
  apiKey: string;
  locationId?: string;
  fromDate: string;
  toDate: string;
}): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; status: number; body: string }> {
  const qs = new URLSearchParams({ from_date: input.fromDate, to_date: input.toDate });
  const loc = String(input.locationId ?? "").trim();
  if (loc) qs.set("location_id", loc);
  return fetchPaginatedArboxList({
    apiKey: input.apiKey,
    firstPath: `/v3/schedule?${qs.toString()}`,
  });
}

export async function fetchArboxBoxCategories(input: {
  apiKey: string;
  locationId?: string;
}): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; status: number; body: string }> {
  const qs = new URLSearchParams();
  const loc = String(input.locationId ?? "").trim();
  if (loc) qs.set("location_id", loc);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return fetchPaginatedArboxList({
    apiKey: input.apiKey,
    firstPath: `/v3/schedule/boxCategories${suffix}`,
  });
}

export function catalogFromBoxCategoryRows(rows: Record<string, unknown>[]): ArboxBoxCategoryCatalog {
  const ids = new Set<number>();
  const names = new Set<string>();
  const nameToId = new Map<string, number>();
  for (const row of rows) {
    const id = Number(row.box_category_id ?? row.id);
    const name = String(row.name ?? row.session_name ?? "").trim();
    if (Number.isFinite(id) && id > 0) ids.add(id);
    if (name) {
      names.add(name);
      if (Number.isFinite(id) && id > 0 && !nameToId.has(name)) nameToId.set(name, id);
    }
  }
  return { ids, names, nameToId, fetchFailed: false };
}

export function normalizeTimetableToWeeklyClasses(
  scheduleRows: Record<string, unknown>[],
  catalog: ArboxBoxCategoryCatalog
): { classes: ArboxWeeklyClass[]; unmatchedSessionNames: string[] } {
  type Acc = {
    session_name: string;
    box_category_id: number | null;
    occurrences: Array<{ date: string; start_time: string }>;
  };
  const byName = new Map<string, Acc>();
  const unmatched: string[] = [];
  const unmatchedSeen = new Set<string>();

  for (const row of scheduleRows) {
    if (Number(row.is_transparent) === 1) continue;
    const session_name = String(row.session_name ?? row.class_name ?? "").trim();
    const date = String(row.date ?? "").trim().slice(0, 10);
    const start_time = normalizeHhmm(row.start_time ?? row.time);
    if (!session_name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !start_time) continue;
    let acc = byName.get(session_name);
    if (!acc) {
      const box_category_id = catalog.nameToId.get(session_name) ?? null;
      if (box_category_id == null && !unmatchedSeen.has(session_name)) {
        unmatchedSeen.add(session_name);
        unmatched.push(session_name);
      }
      acc = { session_name, box_category_id, occurrences: [] };
      byName.set(session_name, acc);
    }
    acc.occurrences.push({ date, start_time });
  }

  const classes: ArboxWeeklyClass[] = [];
  for (const acc of byName.values()) {
    const slots = weeklySlotsFromOccurrences(acc.occurrences);
    if (!slots.length) continue;
    classes.push({
      session_name: acc.session_name,
      box_category_id: acc.box_category_id,
      slots,
    });
  }
  return { classes, unmatchedSessionNames: unmatched };
}

export async function pullArboxWeeklyTimetable(input: {
  apiKey: string;
  locationId?: string;
  now?: Date;
}): Promise<
  | {
      ok: true;
      classes: ArboxWeeklyClass[];
      catalog: ArboxBoxCategoryCatalog;
      unmatchedSessionNames: string[];
      fromDate: string;
      toDate: string;
    }
  | { ok: false; error: string; status?: number }
> {
  const fromDate = israelYmd(input.now);
  const toDate = addDaysYmd(fromDate, WINDOW_DAYS);
  const schedule = await fetchArboxScheduleOccurrences({
    apiKey: input.apiKey,
    locationId: input.locationId,
    fromDate,
    toDate,
  });
  if (!schedule.ok) {
    return { ok: false, error: "schedule_fetch_failed", status: schedule.status };
  }

  // Full catalog lookup — do not filter boxCategories by location_id.
  const cats = await fetchArboxBoxCategories({ apiKey: input.apiKey });
  if (!cats.ok) {
    console.error("[arbox-schedule-sync] boxCategories fetch failed", {
      status: cats.status,
      body: cats.body,
    });
    return { ok: false, error: "box_categories_fetch_failed", status: cats.status };
  }
  const catalog = catalogFromBoxCategoryRows(cats.rows);

  const { classes, unmatchedSessionNames } = normalizeTimetableToWeeklyClasses(schedule.rows, catalog);
  if (unmatchedSessionNames.length) {
    console.warn("[arbox-schedule-sync] session_name missing from boxCategories", {
      names: unmatchedSessionNames,
    });
  }
  return { ok: true, classes, catalog, unmatchedSessionNames, fromDate, toDate };
}

function slugifyArboxClass(sessionName: string, boxCategoryId: number | null): string {
  const fromName = sessionName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (boxCategoryId != null && boxCategoryId > 0) return `arbox-${boxCategoryId}`;
  if (fromName) return `arbox-${fromName}`.slice(0, 80);
  return `arbox-class-${Date.now().toString(36)}`.slice(0, 80);
}

function newSlotId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function defaultNewProductMeta(input: {
  classRow: ArboxWeeklyClass;
  sortOrder: number;
  newId: () => string;
}): ServiceDescriptionBlob {
  return {
    price_text: "",
    duration: "",
    payment_link: "",
    benefit_line: "",
    description_text: "",
    levels_enabled: false,
    levels: [],
    offer_kind: "trial",
    course_sessions_count: "",
    sort_order: input.sortOrder,
    trial_pick_media_url: "",
    trial_pick_media_type: "",
    location_mode: "location",
    course_dates_enabled: true,
    course_start_date: "",
    course_end_date: "",
    schedule_slots: slotsToProductScheduleSlots(input.classRow.slots, input.newId),
    arbox_box_category_id: input.classRow.box_category_id,
    arbox_class_name: input.classRow.session_name,
    schedule_removed_notice: null,
  };
}

export async function persistManualArboxScheduleSync(input: {
  admin: AdminClient;
  businessId: number;
  classes: ArboxWeeklyClass[];
}): Promise<{ created: number; updated: number; services: ServiceRow[] }> {
  const { data: existingRaw, error } = await input.admin
    .from("services")
    .select("id, name, description, service_slug, sort_order, location_mode, location_text, price_text")
    .eq("business_id", input.businessId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  const existing = (existingRaw ?? []) as ServiceRow[];
  const byKey = new Map<string, ServiceRow>();
  for (const row of existing) {
    const stamp = parseArboxClassStamp(parseServiceDescriptionObject(String(row.description ?? "")));
    const key = arboxClassMatchKey(stamp);
    if (key && !byKey.has(key)) byKey.set(key, row);
  }

  const usedSlugs = new Set(existing.map((r) => r.service_slug));
  let nextOrder = existing.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), -1) + 1;
  let created = 0;
  let updated = 0;

  for (const cls of input.classes) {
    const key = arboxClassMatchKey({
      box_category_id: cls.box_category_id,
      session_name: cls.session_name,
    });
    const nameKey = arboxClassMatchKey({ session_name: cls.session_name });
    if (!key) continue;
    const match = byKey.get(key) ?? (nameKey && nameKey !== key ? byKey.get(nameKey) : undefined);
    const slots = slotsToProductScheduleSlots(cls.slots, newSlotId);
    if (match) {
      const patch = mergeServiceDescriptionPatch(String(match.description ?? ""), {
        schedule_slots: slots,
        arbox_box_category_id: cls.box_category_id,
        arbox_class_name: cls.session_name,
        schedule_removed_notice: null,
      });
      const { error: upErr } = await input.admin
        .from("services")
        .update({ description: patch })
        .eq("id", match.id)
        .eq("business_id", input.businessId);
      if (upErr) throw new Error(upErr.message);
      updated += 1;
      byKey.set(key, match);
      continue;
    }

    let slug = slugifyArboxClass(cls.session_name, cls.box_category_id);
    let n = 1;
    while (usedSlugs.has(slug)) {
      n += 1;
      slug = `${slugifyArboxClass(cls.session_name, cls.box_category_id)}-${n}`.slice(0, 80);
    }
    usedSlugs.add(slug);
    const description = JSON.stringify(
      defaultNewProductMeta({ classRow: cls, sortOrder: nextOrder, newId: newSlotId })
    );
    const { error: insErr } = await input.admin.from("services").insert({
      business_id: input.businessId,
      name: cls.session_name.slice(0, 80),
      description,
      location_mode: "location",
      location_text: "",
      price_text: "",
      service_slug: slug,
      sort_order: nextOrder,
    });
    if (insErr) throw new Error(insErr.message);
    created += 1;
    nextOrder += 1;
  }

  const { data: refreshed, error: refErr } = await input.admin
    .from("services")
    .select("id, name, description, service_slug, sort_order, location_mode, location_text, price_text")
    .eq("business_id", input.businessId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (refErr) throw new Error(refErr.message);
  return { created, updated, services: (refreshed ?? []) as ServiceRow[] };
}

export async function persistCronArboxScheduleSync(input: {
  admin: AdminClient;
  businessId: number;
  classes: ArboxWeeklyClass[];
  catalog: ArboxBoxCategoryCatalog;
  nowIso: string;
}): Promise<{ updated: number; cleared: number; notified: number }> {
  if (input.catalog.fetchFailed) {
    throw new Error("catalog_fetch_failed");
  }
  const { data: existingRaw, error } = await input.admin
    .from("services")
    .select("id, name, description, service_slug, sort_order")
    .eq("business_id", input.businessId);
  if (error) throw new Error(error.message);

  const classByKey = indexWeeklyClassesByMatchKey(input.classes);

  let updated = 0;
  let cleared = 0;
  let notified = 0;

  for (const row of (existingRaw ?? []) as ServiceRow[]) {
    const meta = parseServiceDescriptionObject(String(row.description ?? ""));
    const stamp = parseArboxClassStamp(meta);
    const key = arboxClassMatchKey(stamp);
    if (!key) continue;

    const hit = findWeeklyClassForStamp(classByKey, stamp);
    if (hit) {
      const slots = slotsToProductScheduleSlots(hit.slots, newSlotId);
      const patch = mergeServiceDescriptionPatch(String(row.description ?? ""), {
        schedule_slots: slots,
        schedule_removed_notice: null,
      });
      const { error: upErr } = await input.admin
        .from("services")
        .update({ description: patch })
        .eq("id", row.id)
        .eq("business_id", input.businessId);
      if (upErr) throw new Error(upErr.message);
      updated += 1;
      continue;
    }

    const notify = shouldNotifyRemovedClass({ stamp, catalog: input.catalog });
    const noticePatch: ServiceDescriptionBlob = { schedule_slots: [] as ProductScheduleSlot[] };
    if (notify) {
      const prev = stamp.schedule_removed_notice;
      // Re-notify only after a reappearance cleared the notice. A dismissed notice
      // for a class that stayed gone must not pop up again every day.
      if (!prev) {
        noticePatch.schedule_removed_notice = { detected_at: input.nowIso, dismissed: false };
        notified += 1;
      }
    }
    const patch = mergeServiceDescriptionPatch(String(row.description ?? ""), noticePatch);
    const { error: upErr } = await input.admin
      .from("services")
      .update({ description: patch })
      .eq("id", row.id)
      .eq("business_id", input.businessId);
    if (upErr) throw new Error(upErr.message);
    cleared += 1;
  }

  return { updated, cleared, notified };
}

export async function markArboxScheduleSyncedAt(
  admin: AdminClient,
  businessId: number,
  atIso: string
): Promise<void> {
  const { error } = await admin
    .from("businesses")
    .update({ arbox_schedule_synced_at: atIso })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
}

export async function dismissArboxRemovedNotice(input: {
  admin: AdminClient;
  businessId: number;
  serviceSlug: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await input.admin
    .from("services")
    .select("id, description")
    .eq("business_id", input.businessId)
    .eq("service_slug", input.serviceSlug)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "service_not_found" };
  const description = String((data as { description?: string }).description ?? "");
  const stamp = parseArboxClassStamp(parseServiceDescriptionObject(description));
  if (!stamp.schedule_removed_notice) return { ok: true };
  const patch = mergeServiceDescriptionPatch(description, {
    schedule_removed_notice: { ...stamp.schedule_removed_notice, dismissed: true },
  });
  const { error: upErr } = await input.admin
    .from("services")
    .update({ description: patch })
    .eq("id", (data as { id: number }).id)
    .eq("business_id", input.businessId);
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true };
}

export function businessQualifiesForArboxScheduleSync(
  row:
    | { crm_type?: unknown; crm_api_key?: unknown }
    | Record<string, unknown>
    | null
    | undefined
): boolean {
  return businessHasArboxConnection(row as { crm_type?: unknown; crm_api_key?: unknown } | null | undefined);
}
