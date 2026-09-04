import { resolveBusinessSlugVariants } from "@/lib/conversations-sessions";
import { businessHasArboxConnection } from "@/lib/crm/types";
import {
  buildActiveMembershipsReportPath,
  buildSessionsReportPath,
  customerReportsDateRange,
  fetchArboxCustomerUserIds,
  isArboxActiveCustomerMembershipStatus,
  isArboxActiveCustomerSessionStatus,
} from "@/lib/leads/arbox-customer-set";
import { parseLeadIdFromUserId } from "@/lib/leads/arbox-all-leads-report";
import { fetchArboxPagedReportRows } from "@/lib/leads/arbox-paged-report";
import { phoneFromWaMessageSessionId } from "@/lib/manual-bulk/session-phone";
import {
  clampManualBulkWeeks,
  inboundCutoffIso,
  MANUAL_BULK_CONTACTS_MAX_PAGES,
  MANUAL_BULK_CONTACTS_PAGE,
  MANUAL_BULK_MESSAGES_MAX_PAGES,
  MANUAL_BULK_MESSAGES_PAGE,
  membershipRecipientKey,
  talkedRecipientKey,
  type ManualBulkAudienceType,
} from "@/lib/manual-bulk/constants";
import { contactPhoneLookupVariants, normalizePhone } from "@/lib/phone-normalize";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type ManualBulkRecipient = {
  recipientKey: string;
  phone: string | null;
  fullName: string | null;
};

export type ManualBulkSkipCounts = {
  unparseable_session: number;
  not_wa_session: number;
  opted_out: number;
  trial_registered: number;
  customer: number;
  already_sent: number;
  no_contact: number;
};

export type ManualBulkAudienceResult = {
  withPhone: ManualBulkRecipient[];
  withoutPhone: ManualBulkRecipient[];
  skipped: ManualBulkSkipCounts;
  messages_pages: number;
  customer_pages: number;
  hit_message_page_cap: boolean;
};

type ContactRow = {
  id: string;
  phone: string | null;
  full_name: string | null;
  opted_out: boolean | null;
  trial_registered: boolean | null;
  session_phase: string | null;
  self_reported_registered_at?: string | null;
  arbox_user_id: string | null;
};

function emptySkips(): ManualBulkSkipCounts {
  return {
    unparseable_session: 0,
    not_wa_session: 0,
    opted_out: 0,
    trial_registered: 0,
    customer: 0,
    already_sent: 0,
    no_contact: 0,
  };
}

function isZoeRegistered(row: ContactRow): boolean {
  if (row.trial_registered === true) return true;
  if (String(row.session_phase ?? "").trim() === "registered") return true;
  if (String(row.self_reported_registered_at ?? "").trim()) return true;
  return false;
}

function normalizeTypeName(raw: unknown): string {
  return String(raw ?? "").trim();
}

export function membershipTypeMatchesFilter(
  rowTypeName: unknown,
  filterNames: string[]
): boolean {
  if (!filterNames.length) return true;
  const name = normalizeTypeName(rowTypeName);
  if (!name) return false;
  const wanted = new Set(filterNames.map(normalizeTypeName).filter(Boolean));
  return wanted.has(name);
}

function reportPhone(row: Record<string, unknown>): string | null {
  return normalizePhone(row.phone) ?? normalizePhone(row.additional_phone);
}

async function loadAlreadySentKeys(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  templateName: string;
}): Promise<Set<string>> {
  const keys = new Set<string>();
  const page = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await input.admin
      .from("manual_bulk_send_log")
      .select("recipient_key")
      .eq("business_id", input.businessId)
      .eq("template_name", input.templateName)
      .range(from, from + page - 1);
    if (error) {
      if (/does not exist|schema cache|manual_bulk_send_log/i.test(error.message)) return keys;
      console.error("[manual-bulk] send_log lookup failed:", error.message);
      throw new Error("send_log_lookup_failed");
    }
    const rows = data ?? [];
    for (const row of rows) {
      const k = String((row as { recipient_key?: unknown }).recipient_key ?? "").trim();
      if (k) keys.add(k);
    }
    if (rows.length < page) break;
    from += page;
  }
  return keys;
}

async function loadBusinessContacts(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
}): Promise<ContactRow[]> {
  const out: ContactRow[] = [];
  let from = 0;
  for (let page = 0; page < MANUAL_BULK_CONTACTS_MAX_PAGES; page += 1) {
    const { data, error } = await input.admin
      .from("contacts")
      .select(
        "id, phone, full_name, opted_out, trial_registered, session_phase, self_reported_registered_at, arbox_user_id"
      )
      .eq("business_id", input.businessId)
      .range(from, from + MANUAL_BULK_CONTACTS_PAGE - 1);
    if (error) {
      if (/self_reported_registered_at|column/i.test(error.message)) {
        const fallback = await input.admin
          .from("contacts")
          .select("id, phone, full_name, opted_out, trial_registered, session_phase, arbox_user_id")
          .eq("business_id", input.businessId)
          .range(from, from + MANUAL_BULK_CONTACTS_PAGE - 1);
        if (fallback.error) {
          console.error("[manual-bulk] contacts lookup failed:", fallback.error.message);
          throw new Error("contacts_lookup_failed");
        }
        const rows = (fallback.data ?? []) as ContactRow[];
        out.push(...rows);
        if (rows.length < MANUAL_BULK_CONTACTS_PAGE) break;
        from += MANUAL_BULK_CONTACTS_PAGE;
        continue;
      }
      console.error("[manual-bulk] contacts lookup failed:", error.message);
      throw new Error("contacts_lookup_failed");
    }
    const rows = (data ?? []) as ContactRow[];
    out.push(...rows);
    if (rows.length < MANUAL_BULK_CONTACTS_PAGE) break;
    from += MANUAL_BULK_CONTACTS_PAGE;
  }
  return out;
}

function indexContacts(rows: ContactRow[]): {
  byPhone: Map<string, ContactRow>;
  byArboxUserId: Map<number, ContactRow>;
} {
  const byPhone = new Map<string, ContactRow>();
  const byArboxUserId = new Map<number, ContactRow>();
  for (const row of rows) {
    const arboxId = parseLeadIdFromUserId(row.arbox_user_id);
    if (arboxId != null) byArboxUserId.set(arboxId, row);
    for (const variant of contactPhoneLookupVariants(row.phone)) {
      if (!byPhone.has(variant)) byPhone.set(variant, row);
    }
  }
  return { byPhone, byArboxUserId };
}

function findContactByPhone(byPhone: Map<string, ContactRow>, phone: string): ContactRow | null {
  for (const variant of contactPhoneLookupVariants(phone)) {
    const hit = byPhone.get(variant);
    if (hit) return hit;
  }
  return null;
}

async function fetchInboundUserSessionIds(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  slugVariants: string[];
  cutoffIso: string;
}): Promise<{ sessionIds: string[]; pages: number; hitCap: boolean }> {
  const sessionIds: string[] = [];
  let from = 0;
  let pages = 0;
  let hitCap = false;
  for (let page = 0; page < MANUAL_BULK_MESSAGES_MAX_PAGES; page += 1) {
    const { data, error } = await input.admin
      .from("messages")
      .select("session_id")
      .in("business_slug", input.slugVariants)
      .eq("role", "user")
      .gte("created_at", input.cutoffIso)
      .order("created_at", { ascending: false })
      .range(from, from + MANUAL_BULK_MESSAGES_PAGE - 1);
    pages += 1;
    if (error) {
      console.error("[manual-bulk] inbound messages lookup failed:", error.message);
      throw new Error("inbound_messages_lookup_failed");
    }
    const rows = data ?? [];
    for (const row of rows) {
      const sid = String((row as { session_id?: unknown }).session_id ?? "").trim();
      if (sid) sessionIds.push(sid);
    }
    if (rows.length < MANUAL_BULK_MESSAGES_PAGE) {
      return { sessionIds, pages, hitCap };
    }
    from += MANUAL_BULK_MESSAGES_PAGE;
    if (page === MANUAL_BULK_MESSAGES_MAX_PAGES - 1) hitCap = true;
  }
  if (hitCap) {
    console.warn("[manual-bulk] inbound messages pagination capped", {
      max_pages: MANUAL_BULK_MESSAGES_MAX_PAGES,
    });
  }
  return { sessionIds, pages, hitCap };
}

async function fetchMembershipAudienceRows(input: {
  apiKey: string;
  boxId: string;
  includePunchCards: boolean;
  typeNames: string[];
}): Promise<
  | { ok: true; rows: Array<{ userId: number; phone: string | null; typeName: string }>; pages: number }
  | { ok: false; error: string }
> {
  const { fromDate, toDate } = customerReportsDateRange();
  const memberships = await fetchArboxPagedReportRows({
    apiKey: input.apiKey,
    locationId: input.boxId,
    logLabel: "manual-bulk/activeMembershipsReport",
    buildPath: (page) =>
      buildActiveMembershipsReportPath({
        fromDate,
        toDate,
        locationId: input.boxId,
        page,
      }),
  });
  if (!memberships.ok) return { ok: false, error: "arbox_active_memberships_fetch_failed" };

  const sourceRows: Record<string, unknown>[] = [...memberships.rows];
  let pages = memberships.pagesFetched;

  if (input.includePunchCards) {
    const sessions = await fetchArboxPagedReportRows({
      apiKey: input.apiKey,
      locationId: input.boxId,
      logLabel: "manual-bulk/sessionsReport",
      buildPath: (page) =>
        buildSessionsReportPath({
          fromDate,
          toDate,
          locationId: input.boxId,
          page,
        }),
    });
    if (!sessions.ok) return { ok: false, error: "arbox_sessions_report_fetch_failed" };
    sourceRows.push(...sessions.rows);
    pages += sessions.pagesFetched;
  }

  const byUser = new Map<number, { userId: number; phone: string | null; typeName: string }>();
  for (const row of sourceRows) {
    const isMembership = isArboxActiveCustomerMembershipStatus(row.status);
    const isSession = isArboxActiveCustomerSessionStatus(row.status);
    if (!isMembership && !isSession) continue;
    if (!membershipTypeMatchesFilter(row.membership_type_name, input.typeNames)) continue;
    const userId = parseLeadIdFromUserId(row.user_id);
    if (userId == null) continue;
    const prev = byUser.get(userId);
    const phone = reportPhone(row);
    if (!prev) {
      byUser.set(userId, {
        userId,
        phone,
        typeName: normalizeTypeName(row.membership_type_name),
      });
      continue;
    }
    if (!prev.phone && phone) prev.phone = phone;
  }

  return { ok: true, rows: [...byUser.values()], pages };
}

export async function buildManualBulkAudience(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  businessSlug: string;
  audienceType: ManualBulkAudienceType;
  templateName: string;
  weeks?: number;
  membershipTypeNames?: string[];
  includePunchCards?: boolean;
}): Promise<ManualBulkAudienceResult> {
  const skipped = emptySkips();
  const alreadySent = await loadAlreadySentKeys({
    admin: input.admin,
    businessId: input.businessId,
    templateName: input.templateName,
  });
  const contacts = await loadBusinessContacts({
    admin: input.admin,
    businessId: input.businessId,
  });
  const { byPhone, byArboxUserId } = indexContacts(contacts);

  if (input.audienceType === "membership") {
    const { data: biz, error: bizErr } = await input.admin
      .from("businesses")
      .select("crm_type, crm_api_key, crm_box_id")
      .eq("id", input.businessId)
      .maybeSingle();
    if (bizErr) {
      console.error("[manual-bulk] business crm lookup failed:", bizErr.message);
      throw new Error("business_lookup_failed");
    }
    if (!businessHasArboxConnection(biz)) {
      throw new Error("audience_membership_requires_arbox");
    }
    const apiKey = String((biz as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
    const boxId = String((biz as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
    if (!apiKey || !boxId) throw new Error("missing_crm_credentials");

    const report = await fetchMembershipAudienceRows({
      apiKey,
      boxId,
      includePunchCards: Boolean(input.includePunchCards),
      typeNames: (input.membershipTypeNames ?? []).map(normalizeTypeName).filter(Boolean),
    });
    if (!report.ok) throw new Error(report.error);

    const withPhone: ManualBulkRecipient[] = [];
    const withoutPhone: ManualBulkRecipient[] = [];
    for (const row of report.rows) {
      const recipientKey = membershipRecipientKey(row.userId);
      if (alreadySent.has(recipientKey)) {
        skipped.already_sent += 1;
        continue;
      }
      const contact = byArboxUserId.get(row.userId) ?? (row.phone ? findContactByPhone(byPhone, row.phone) : null);
      if (contact?.opted_out === true) {
        skipped.opted_out += 1;
        continue;
      }
      const phone = row.phone ?? (contact?.phone ? normalizePhone(contact.phone) : null);
      const rec: ManualBulkRecipient = {
        recipientKey,
        phone,
        fullName: contact?.full_name ?? null,
      };
      if (phone) withPhone.push(rec);
      else withoutPhone.push(rec);
    }
    return {
      withPhone,
      withoutPhone,
      skipped,
      messages_pages: 0,
      customer_pages: report.pages,
      hit_message_page_cap: false,
    };
  }

  const weeks = clampManualBulkWeeks(input.weeks);
  const slugVariants = await resolveBusinessSlugVariants(input.admin, input.businessSlug);
  if (!slugVariants.length) {
    throw new Error("missing_business_slug");
  }
  const inbound = await fetchInboundUserSessionIds({
    admin: input.admin,
    slugVariants,
    cutoffIso: inboundCutoffIso(weeks),
  });

  const inboundPhones = new Map<string, true>();
  for (const sid of inbound.sessionIds) {
    const parsed = phoneFromWaMessageSessionId(sid);
    if (!parsed.ok) {
      if (parsed.reason === "not_wa" || parsed.reason === "empty") skipped.not_wa_session += 1;
      else skipped.unparseable_session += 1;
      continue;
    }
    inboundPhones.set(parsed.phone, true);
  }

  const { data: biz } = await input.admin
    .from("businesses")
    .select("crm_type, crm_api_key, crm_box_id")
    .eq("id", input.businessId)
    .maybeSingle();
  let customerIds = new Set<number>();
  let customerPages = 0;
  if (businessHasArboxConnection(biz)) {
    const apiKey = String((biz as { crm_api_key?: unknown }).crm_api_key ?? "").trim();
    const boxId = String((biz as { crm_box_id?: unknown }).crm_box_id ?? "").trim();
    if (apiKey && boxId) {
      const customers = await fetchArboxCustomerUserIds({ apiKey, boxId });
      if (!customers.ok) throw new Error(customers.error);
      customerIds = customers.userIds;
      customerPages = customers.membershipPages + customers.sessionPages;
    }
  }

  const withPhone: ManualBulkRecipient[] = [];
  const seenKeys = new Set<string>();
  for (const phone of inboundPhones.keys()) {
    const contact = findContactByPhone(byPhone, phone);
    if (!contact) {
      skipped.no_contact += 1;
      const recipientKey = talkedRecipientKey(null, phone);
      if (alreadySent.has(recipientKey) || seenKeys.has(recipientKey)) {
        if (alreadySent.has(recipientKey)) skipped.already_sent += 1;
        continue;
      }
      seenKeys.add(recipientKey);
      withPhone.push({ recipientKey, phone, fullName: null });
      continue;
    }
    if (contact.opted_out === true) {
      skipped.opted_out += 1;
      continue;
    }
    if (isZoeRegistered(contact)) {
      skipped.trial_registered += 1;
      continue;
    }
    const arboxId = parseLeadIdFromUserId(contact.arbox_user_id);
    if (arboxId != null && customerIds.has(arboxId)) {
      skipped.customer += 1;
      continue;
    }
    const recipientKey = talkedRecipientKey(String(contact.id), phone);
    if (alreadySent.has(recipientKey) || seenKeys.has(recipientKey)) {
      if (alreadySent.has(recipientKey)) skipped.already_sent += 1;
      continue;
    }
    seenKeys.add(recipientKey);
    withPhone.push({
      recipientKey,
      phone: normalizePhone(contact.phone) ?? phone,
      fullName: contact.full_name,
    });
  }

  return {
    withPhone,
    withoutPhone: [],
    skipped,
    messages_pages: inbound.pages,
    customer_pages: customerPages,
    hit_message_page_cap: inbound.hitCap,
  };
}
