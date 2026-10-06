import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { mapMarketingFlowSessionToLeadRow } from "@/lib/leads-data";
import type { LeadRow } from "@/lib/leads-types";
import { normalizePhone } from "@/lib/phone-normalize";
import {
  buildZoeAdminCalendarIcs,
  zoeAdminCalendarEventFromLead,
  type ZoeAdminCalendarEvent,
} from "@/lib/zoe-admin-calendar";

const SESSION_SELECT =
  "phone, full_name, created_at, updated_at, last_user_message_at, flow_completed, current_node_id, human_followup_at, next_call_at, next_call_time, pipeline_status";

const PIPELINE_CALL_STATUSES = ["setup_call", "requires_call", "human_followup"] as const;
const NOTE_CALL_STATUSES = ["setup_call", "requires_call"] as const;
const ROW_LIMIT = 2000;

type NoteHint = { status: string; relevance: string | null };

function phoneKey(phone: string): string {
  const trimmed = String(phone ?? "").trim();
  if (!trimmed) return "";
  return normalizePhone(trimmed) ?? trimmed.replace(/\D/g, "");
}

function phoneLookupVariants(phone: string): string[] {
  const trimmed = String(phone ?? "").trim();
  const normalized = normalizePhone(trimmed);
  const local = normalized ? `0${normalized.slice(3)}` : "";
  const plus = normalized ? `+${normalized}` : "";
  return [...new Set([trimmed, normalized ?? "", local, plus].filter(Boolean))];
}

function leadFromSession(session: Record<string, unknown>, note: NoteHint | undefined): LeadRow {
  return mapMarketingFlowSessionToLeadRow(session, {
    noteStatus: note?.status ?? null,
    noteRelevance: note?.relevance ?? null,
    hasMarketingNote: Boolean(note),
    pipelineStatus: typeof session.pipeline_status === "string" ? session.pipeline_status : null,
  });
}

export function zoeAdminCalendarEventsFromRows(
  sessions: Record<string, unknown>[],
  notes: Array<{ phone?: string | null; status?: string | null; relevance?: string | null }>
): ZoeAdminCalendarEvent[] {
  const notesByPhone = new Map<string, NoteHint>();
  for (const note of notes) {
    const key = phoneKey(String(note.phone ?? ""));
    if (!key) continue;
    notesByPhone.set(key, {
      status: String(note.status ?? ""),
      relevance: note.relevance ?? null,
    });
  }
  const events: ZoeAdminCalendarEvent[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    const key = phoneKey(String(session.phone ?? ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const event = zoeAdminCalendarEventFromLead(leadFromSession(session, notesByPhone.get(key)));
    if (event) events.push(event);
  }
  return events;
}

async function loadNotes(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  phones: string[]
): Promise<Array<{ phone?: string | null; status?: string | null; relevance?: string | null }>> {
  const unique = [...new Set(phones.flatMap((p) => phoneLookupVariants(p)))];
  if (unique.length === 0) return [];
  const result = await admin
    .from("marketing_conversation_notes")
    .select("phone, status, relevance")
    .in("phone", unique)
    .limit(ROW_LIMIT);
  if (result.error && /relevance|column|schema cache/i.test(result.error.message)) {
    console.warn("[zoe-admin-calendar] relevance column missing — run supabase/marketing_admin_status_layers.sql");
    const legacy = await admin
      .from("marketing_conversation_notes")
      .select("phone, status")
      .in("phone", unique)
      .limit(ROW_LIMIT);
    if (legacy.error) {
      console.error("[zoe-admin-calendar] notes lookup failed:", legacy.error.message);
      throw new Error("notes_lookup_failed");
    }
    return (legacy.data ?? []) as Array<{ phone?: string | null; status?: string | null }>;
  }
  if (result.error) {
    console.error("[zoe-admin-calendar] notes lookup failed:", result.error.message);
    throw new Error("notes_lookup_failed");
  }
  return result.data ?? [];
}

/**
 * לידים בעמודות שיחת הקמה / דורש שיחה.
 * שתי שאילתות עם WHERE ממוקד (סטטוס), ואז הערות רק לטלפונים שעלו.
 * בלי סריקת messages. נפח: עשרות עד מאות שורות בקו זואי אדמין, לא לפי לקוחות.
 */
export async function loadZoeAdminCalendarEvents(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<ZoeAdminCalendarEvent[]> {
  const [byPipeline, byNote] = await Promise.all([
    admin
      .from("marketing_flow_sessions")
      .select(SESSION_SELECT)
      .in("pipeline_status", [...PIPELINE_CALL_STATUSES])
      .not("next_call_at", "is", null)
      .limit(ROW_LIMIT),
    admin
      .from("marketing_conversation_notes")
      .select("phone")
      .in("status", [...NOTE_CALL_STATUSES])
      .limit(ROW_LIMIT),
  ]);

  if (byPipeline.error) {
    console.error("[zoe-admin-calendar] sessions lookup failed:", byPipeline.error.message);
    throw new Error("sessions_lookup_failed");
  }
  if (byNote.error) {
    console.error("[zoe-admin-calendar] note phones lookup failed:", byNote.error.message);
    throw new Error("notes_lookup_failed");
  }
  if ((byPipeline.data ?? []).length >= ROW_LIMIT || (byNote.data ?? []).length >= ROW_LIMIT) {
    console.error("[zoe-admin-calendar] row limit reached — calendar feed may be incomplete");
  }

  const sessions = new Map<string, Record<string, unknown>>();
  for (const row of byPipeline.data ?? []) {
    const key = phoneKey(String((row as { phone?: string }).phone ?? ""));
    if (key) sessions.set(key, row as Record<string, unknown>);
  }

  const notePhones = (byNote.data ?? [])
    .map((row) => String((row as { phone?: string }).phone ?? "").trim())
    .filter(Boolean);
  const missing = notePhones.filter((phone) => !sessions.has(phoneKey(phone)));
  if (missing.length > 0) {
    const extra = await admin
      .from("marketing_flow_sessions")
      .select(SESSION_SELECT)
      .in("phone", missing.flatMap(phoneLookupVariants).slice(0, ROW_LIMIT))
      .limit(ROW_LIMIT);
    if (extra.error) {
      console.error("[zoe-admin-calendar] extra sessions lookup failed:", extra.error.message);
      throw new Error("sessions_lookup_failed");
    }
    for (const row of extra.data ?? []) {
      const key = phoneKey(String((row as { phone?: string }).phone ?? ""));
      if (key) sessions.set(key, row as Record<string, unknown>);
    }
  }

  const phones = [...sessions.values()].map((row) => String(row.phone ?? ""));
  const notes = await loadNotes(admin, phones);
  return zoeAdminCalendarEventsFromRows([...sessions.values()], notes);
}

export async function buildZoeAdminCalendarFeed(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  now = new Date()
): Promise<{ ics: string; count: number }> {
  const events = await loadZoeAdminCalendarEvents(admin);
  return { ics: buildZoeAdminCalendarIcs(events, now), count: events.length };
}
