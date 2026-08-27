import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { matchesMarketingRegisteredClick } from "@/lib/admin-marketing-analytics";
import {
  extractLeadPhoneFromMarketingSession,
  MARKETING_CONVERSATIONS_SLUG,
} from "@/lib/marketing-whatsapp";
import { leadConversationAt, sortLeadsByRecentActivity } from "@/lib/lead-activity";
import { normalizePhone } from "@/lib/phone-normalize";
import type { LeadRow } from "@/lib/leads-types";
import { applyMarketingLeadStatusHints } from "@/lib/marketing-pipeline-status";

export { leadConversationAt } from "@/lib/lead-activity";

function phoneKey(phone: string): string {
  const p = String(phone ?? "").trim();
  return p ? normalizePhone(p) ?? p.replace(/\D/g, "") : "";
}

/** איחוד שורות כפולות (972... מול +972...) — שומר את השורה העדכנית ביותר */
function dedupeLeadsByPhone(
  rows: LeadRow[],
  keyFor: (row: LeadRow) => string = (row) => phoneKey(String(row.phone ?? ""))
): LeadRow[] {
  const byKey = new Map<string, LeadRow>();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const prevAt = leadConversationAt(prev);
    const rowAt = leadConversationAt(row);
    const pick =
      rowAt && prevAt
        ? new Date(rowAt).getTime() >= new Date(prevAt).getTime()
          ? row
          : prev
        : row.full_name?.trim() && !prev.full_name?.trim()
          ? row
          : prev;
    byKey.set(key, pick);
  }
  return [...byKey.values()];
}

function mapWaStage(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function toDateOnly(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const LEAD_CONTACT_SELECT_BASE =
  "phone, full_name, source, created_at, opted_out, not_relevant_at, not_relevant_reason, session_phase, trial_registered, wa_no_response_at, no_response_notified_at, wa_followup_stage, last_contact_at";

function mapContactRow(row: Record<string, unknown>, extras?: Partial<LeadRow>): LeadRow {
  return {
    phone: row.phone as string | null,
    full_name: row.full_name as string | null,
    source: row.source as string | null,
    created_at: row.created_at as string | null,
    opted_out: row.opted_out as boolean | null,
    not_relevant_at: row.not_relevant_at as string | null,
    not_relevant_reason: row.not_relevant_reason as string | null,
    human_requested_at: (row.human_requested_at as string | null) ?? null,
    human_followup_at: (row.human_followup_at as string | null) ?? null,
    next_call_at: (row.next_call_at as string | null) ?? null,
    session_phase: row.session_phase as string | null,
    trial_registered: row.trial_registered as boolean | null,
    wa_no_response_at: row.wa_no_response_at as string | null,
    no_response_notified_at: row.no_response_notified_at as string | null,
    wa_followup_stage: mapWaStage(row.wa_followup_stage),
    last_contact_at: row.last_contact_at as string | null,
    cta_clicked_at: extras?.cta_clicked_at ?? null,
    business_slug: extras?.business_slug ?? null,
    business_name: extras?.business_name ?? null,
  };
}

const CONTACTS_PAGE = 1000;
const CONTACTS_CAP = 4000;

async function fetchPagedContactRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  columns: string
): Promise<{ rows: Record<string, unknown>[]; error: { message?: string } | null }> {
  const rows: Record<string, unknown>[] = [];
  for (let off = 0; off < CONTACTS_CAP; off += CONTACTS_PAGE) {
    const { data, error } = await admin
      .from("contacts")
      .select(columns)
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .range(off, off + CONTACTS_PAGE - 1);
    if (error) return { rows, error };
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < CONTACTS_PAGE) break;
  }
  return { rows, error: null };
}

async function fetchBusinessContactRows(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<Record<string, unknown>[]> {
  const withHuman = `${LEAD_CONTACT_SELECT_BASE}, human_requested_at`;
  const primary = await fetchPagedContactRows(admin, businessId, withHuman);
  if (!primary.error) return primary.rows;

  if (/human_requested_at|column/i.test(String(primary.error.message ?? ""))) {
    console.warn("[leads-data] human_requested_at missing — fallback select without column");
    const legacy = await fetchPagedContactRows(admin, businessId, LEAD_CONTACT_SELECT_BASE);
    if (legacy.error) {
      console.error("[leads-data] contacts load failed:", legacy.error.message);
      return [];
    }
    return legacy.rows;
  }

  console.error("[leads-data] contacts load failed:", primary.error.message);
  return [];
}

export async function loadLeadsForBusiness(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number
): Promise<LeadRow[]> {
  const contacts = await fetchBusinessContactRows(admin, businessId);

  const conversations: { phone?: string; cta_clicked_at?: string | null }[] = [];
  for (let off = 0; off < CONTACTS_CAP; off += CONTACTS_PAGE) {
    const { data, error } = await admin
      .from("conversations")
      .select("phone, cta_clicked_at")
      .eq("business_id", businessId)
      .range(off, off + CONTACTS_PAGE - 1);
    if (error) {
      console.warn("[leads-data] conversations load:", error.message);
      break;
    }
    const batch = data ?? [];
    conversations.push(...batch);
    if (batch.length < CONTACTS_PAGE) break;
  }

  const ctaByPhone = new Map<string, string | null>();
  for (const row of conversations ?? []) {
    const raw = row as { phone?: string; cta_clicked_at?: string | null };
    const key = phoneKey(String(raw.phone ?? ""));
    if (!key) continue;
    ctaByPhone.set(key, raw.cta_clicked_at ?? null);
  }

  const rows = contacts.map((c) => {
    const phone = String(c.phone ?? "").trim();
    const key = phoneKey(phone);
    return mapContactRow(c, { cta_clicked_at: key ? (ctaByPhone.get(key) ?? null) : null });
  });
  return sortLeadsByRecentActivity(dedupeLeadsByPhone(rows));
}

const ADMIN_LEADS_LIMIT = 10_000;

function deriveMarketingWaFollowupStage(row: {
  followup_1_sent_at?: string | null;
  followup_2_sent_at?: string | null;
  followup_3_sent_at?: string | null;
}): number {
  if (row.followup_3_sent_at) return 3;
  if (row.followup_2_sent_at) return 2;
  if (row.followup_1_sent_at) return 1;
  return 0;
}

function deriveMarketingSessionPhase(
  row: { flow_completed?: boolean | null; current_node_id?: string | null },
  registered: boolean
): string | null {
  if (registered) return "registered";
  if (row.flow_completed) return "cta";
  if (row.current_node_id) return "opening";
  return null;
}

/**
 * `followup_opted_out` עוצר פולואפים אוטומטיים (נרשם / ביקש נציג / לא רלוונטי).
 * זה לא הסרה מוואטסאפ — עמודת «הסר» בפייפליין היא רק `opted_out`.
 */
export function mapMarketingFlowSessionToLeadRow(
  s: Record<string, unknown>,
  registeredOrHints: boolean | {
    registeredFromMessage?: boolean;
    noteStatus?: string | null;
    noteUpdatedAt?: string | null;
    pipelineStatus?: string | null;
  } = false
): LeadRow {
  const hints =
    typeof registeredOrHints === "boolean"
      ? { registeredFromMessage: registeredOrHints }
      : registeredOrHints;
  const registered = Boolean(hints.registeredFromMessage);
  const phone = String(s.phone ?? "").trim();
  const waStage = deriveMarketingWaFollowupStage({
    followup_1_sent_at: s.followup_1_sent_at as string | null,
    followup_2_sent_at: s.followup_2_sent_at as string | null,
    followup_3_sent_at: s.followup_3_sent_at as string | null,
  });
  const lastContact =
    (s.last_user_message_at as string | null) ??
    (s.updated_at as string | null) ??
    (s.created_at as string | null);

  const row: LeadRow = {
    phone: phone || null,
    full_name: (s.full_name as string | null) ?? null,
    source: "זואי אדמין",
    created_at: s.created_at as string | null,
    opted_out: false,
    not_relevant_at: null,
    not_relevant_reason: null,
    human_requested_at: null,
    human_followup_at: (s.human_followup_at as string | null) ?? null,
    next_call_at: toDateOnly(s.next_call_at),
    session_phase: deriveMarketingSessionPhase(
      {
        flow_completed: s.flow_completed as boolean | null,
        current_node_id: s.current_node_id as string | null,
      },
      registered
    ),
    trial_registered: registered,
    wa_no_response_at: null,
    no_response_notified_at: null,
    wa_followup_stage: waStage,
    last_contact_at: lastContact,
    cta_clicked_at: null,
    business_slug: MARKETING_CONVERSATIONS_SLUG,
    business_name: "זואי אדמין",
    pipeline_status: typeof s.pipeline_status === "string" ? s.pipeline_status : null,
  };
  return applyMarketingLeadStatusHints(row, {
    registeredFromMessage: registered,
    noteStatus: hints.noteStatus,
    noteUpdatedAt: hints.noteUpdatedAt,
    pipelineStatus: hints.pipelineStatus ?? (typeof s.pipeline_status === "string" ? s.pipeline_status : null),
  });
}

async function loadMarketingRegisteredPhoneKeys(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<Set<string>> {
  const { data: messages, error } = await admin
    .from("messages")
    .select("session_id, content")
    .eq("business_slug", MARKETING_CONVERSATIONS_SLUG)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(50_000);

  if (error) {
    console.warn("[leads-data] marketing registered messages:", error.message);
    return new Set();
  }

  const keys = new Set<string>();
  for (const row of messages ?? []) {
    const raw = row as { session_id?: string; content?: string };
    if (!matchesMarketingRegisteredClick(String(raw.content ?? ""))) continue;
    const phone = extractLeadPhoneFromMarketingSession(String(raw.session_id ?? ""));
    const key = phoneKey(phone);
    if (key) keys.add(key);
  }
  return keys;
}

async function loadMarketingNoteStatusByPhone(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<Map<string, { status: string; updatedAt: string | null }>> {
  const { data, error } = await admin
    .from("marketing_conversation_notes")
    .select("phone, status, updated_at")
    .limit(ADMIN_LEADS_LIMIT);
  const map = new Map<string, { status: string; updatedAt: string | null }>();
  if (error) {
    console.warn("[leads-data] marketing_conversation_notes load:", error.message);
    return map;
  }
  for (const row of data ?? []) {
    const raw = row as { phone?: string; status?: string; updated_at?: string | null };
    const key = phoneKey(String(raw.phone ?? "").trim());
    if (!key) continue;
    map.set(key, {
      status: String(raw.status ?? ""),
      updatedAt: raw.updated_at ?? null,
    });
  }
  return map;
}

/** לידים מקו זואי אדמין (שיווק) — לא מטבלת contacts של עסקים */
export async function loadMarketingAdminLeads(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<LeadRow[]> {
  const marketingSelectWithPipeline = `
        phone, full_name, created_at, updated_at, last_user_message_at,
        flow_completed, current_node_id,
        followup_opted_out, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at,
        human_followup_at, next_call_at, pipeline_status
      `;
  const marketingSelectLegacyHuman = `
        phone, full_name, created_at, updated_at, last_user_message_at,
        flow_completed, current_node_id,
        followup_opted_out, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at,
        human_followup_at, next_call_at
      `;
  const marketingSelectLegacy = `
        phone, full_name, created_at, updated_at, last_user_message_at,
        flow_completed, current_node_id,
        followup_opted_out, followup_1_sent_at, followup_2_sent_at, followup_3_sent_at
      `;

  const [{ data: sessions, error }, registeredKeys, notesByPhone] = await Promise.all([
    admin
      .from("marketing_flow_sessions")
      .select(marketingSelectWithPipeline)
      .order("last_user_message_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(ADMIN_LEADS_LIMIT),
    loadMarketingRegisteredPhoneKeys(admin),
    loadMarketingNoteStatusByPhone(admin),
  ]);

  let sessionRows: Record<string, unknown>[] | null = (sessions ?? null) as Record<string, unknown>[] | null;
  if (error) {
    if (/pipeline_status|column/i.test(String(error.message ?? ""))) {
      console.warn("[leads-data] marketing pipeline_status missing — fallback select");
      const fallback = await admin
        .from("marketing_flow_sessions")
        .select(marketingSelectLegacyHuman)
        .order("last_user_message_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(ADMIN_LEADS_LIMIT);
      if (fallback.error) {
        if (/human_followup_at|next_call_at|column/i.test(String(fallback.error.message ?? ""))) {
          console.warn("[leads-data] marketing pipeline columns missing — fallback select");
          const legacy = await admin
            .from("marketing_flow_sessions")
            .select(marketingSelectLegacy)
            .order("last_user_message_at", { ascending: false, nullsFirst: false })
            .order("updated_at", { ascending: false })
            .limit(ADMIN_LEADS_LIMIT);
          if (legacy.error) {
            console.warn("[leads-data] marketing_flow_sessions load:", legacy.error.message);
            return [];
          }
          sessionRows = (legacy.data ?? []) as Record<string, unknown>[];
        } else {
          console.warn("[leads-data] marketing_flow_sessions load:", fallback.error.message);
          return [];
        }
      } else {
        sessionRows = (fallback.data ?? []) as Record<string, unknown>[];
      }
    } else if (/human_followup_at|next_call_at|column/i.test(String(error.message ?? ""))) {
      console.warn("[leads-data] marketing pipeline columns missing — fallback select");
      const fallback = await admin
        .from("marketing_flow_sessions")
        .select(marketingSelectLegacy)
        .order("last_user_message_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(ADMIN_LEADS_LIMIT);
      if (fallback.error) {
        console.warn("[leads-data] marketing_flow_sessions load:", fallback.error.message);
        return [];
      }
      sessionRows = (fallback.data ?? []) as Record<string, unknown>[];
    } else {
      console.warn("[leads-data] marketing_flow_sessions load:", error.message);
      return [];
    }
  }

  const rows = (sessionRows ?? []).map((row) => {
    const s = row as Record<string, unknown>;
    const key = phoneKey(String(s.phone ?? "").trim());
    const note = key ? notesByPhone.get(key) : undefined;
    return mapMarketingFlowSessionToLeadRow(s, {
      registeredFromMessage: key ? registeredKeys.has(key) : false,
      noteStatus: note?.status ?? null,
      noteUpdatedAt: note?.updatedAt ?? null,
      pipelineStatus: typeof s.pipeline_status === "string" ? s.pipeline_status : null,
    });
  });
  return sortLeadsByRecentActivity(rows);
}

export async function loadLeadsForAdmin(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<LeadRow[]> {
  const adminSelectWithHuman = `
      ${LEAD_CONTACT_SELECT_BASE}, human_requested_at,
      business_id,
      businesses ( slug, name )
    `;
  const adminSelectLegacy = `
      ${LEAD_CONTACT_SELECT_BASE},
      business_id,
      businesses ( slug, name )
    `;

  let contacts: Record<string, unknown>[] | null = null;
  const { data, error } = await admin.from("contacts").select(adminSelectWithHuman).limit(ADMIN_LEADS_LIMIT);

  if (!error) {
    contacts = (data ?? []) as Record<string, unknown>[];
  } else if (/human_requested_at|column/i.test(String(error.message ?? ""))) {
    console.warn("[leads-data] admin human_requested_at missing — fallback select");
    const { data: legacy, error: legacyErr } = await admin
      .from("contacts")
      .select(adminSelectLegacy)
      .limit(ADMIN_LEADS_LIMIT);
    if (legacyErr) {
      console.warn("[leads-data] admin contacts load:", legacyErr.message);
      return [];
    }
    contacts = (legacy ?? []) as Record<string, unknown>[];
  } else {
    console.warn("[leads-data] admin contacts load:", error.message);
    return [];
  }

  const { data: conversations } = await admin.from("conversations").select("business_id, phone, cta_clicked_at");

  const ctaMap = new Map<string, string | null>();
  for (const row of conversations ?? []) {
    const raw = row as { business_id?: number; phone?: string; cta_clicked_at?: string | null };
    const bid = raw.business_id;
    const key = phoneKey(String(raw.phone ?? ""));
    if (bid == null || !key) continue;
    ctaMap.set(`${bid}:${key}`, raw.cta_clicked_at ?? null);
  }

  const rows = (contacts ?? []).map((row) => {
    const c = row as Record<string, unknown> & {
      business_id?: number;
      businesses?: { slug?: string; name?: string | null } | { slug?: string; name?: string | null }[] | null;
    };
    const bizRaw = c.businesses;
    const biz = Array.isArray(bizRaw) ? bizRaw[0] : bizRaw;
    const businessId = c.business_id;
    const phone = String(c.phone ?? "").trim();
    const key = phoneKey(phone);
    return mapContactRow(c, {
      business_slug: biz?.slug ?? null,
      business_name: biz?.name ?? null,
      cta_clicked_at: businessId != null && key ? (ctaMap.get(`${businessId}:${key}`) ?? null) : null,
    });
  });
  return sortLeadsByRecentActivity(
    dedupeLeadsByPhone(rows, (row) => `${row.business_slug ?? ""}:${phoneKey(String(row.phone ?? ""))}`)
  );
}
