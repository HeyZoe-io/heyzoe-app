import { after, NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { normalizePhone } from "@/lib/phone-normalize";
import {
  coerceMarketingNoteStatus,
  DEFAULT_MARKETING_NOTE_STATUS,
  type MarketingNoteStatus,
} from "@/lib/marketing-conversation-notes";
import {
  isMarketingRelevance,
  isMarketingStage,
  marketingAdminColumnStopsFollowups,
  splitStoredMarketingStatus,
  type MarketingRelevance,
  type MarketingStage,
} from "@/lib/marketing-admin-status";
import { markMarketingFollowupOptedOut } from "@/lib/marketing-followups";
import {
  canonicalMarketingSessionId,
  extractLeadPhoneFromMarketingSession,
} from "@/lib/marketing-whatsapp";
import { syncContactToMetaAudience } from "@/lib/ads/meta-audiences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NoteStatus = MarketingNoteStatus;

const NOTE_SELECT =
  "phone, session_id, business_name, link, notes, status, relevance, conversation_at, updated_at";
const NOTE_SELECT_LEGACY =
  "phone, session_id, business_name, link, notes, status, conversation_at, updated_at";

async function requireAdmin(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return false;
  return isAdminAllowedEmail(data.user.email);
}

function resolvePhoneKey(rawPhone: string, sessionId: string): string {
  const fromSession = extractLeadPhoneFromMarketingSession(sessionId);
  const candidate = (rawPhone || fromSession).trim();
  if (!candidate) return "";
  return normalizePhone(candidate) || candidate.replace(/\D/g, "") || candidate;
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

function normalizeLink(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 2000);
}

function serializeNote(
  data: {
    phone?: string | null;
    session_id?: string | null;
    business_name?: string | null;
    link?: string | null;
    notes?: string | null;
    status?: string | null;
    relevance?: string | null;
    conversation_at?: string | null;
    updated_at?: string | null;
  },
  fallbackPhone: string,
  fallbackStatus?: NoteStatus,
  fallbackRelevance?: MarketingRelevance
) {
  const split = splitStoredMarketingStatus({
    status: data.status,
    relevance: data.relevance ?? fallbackRelevance,
    hasNote: true,
  });
  const stage = isMarketingStage(data.status)
    ? data.status
    : (fallbackStatus && isMarketingStage(fallbackStatus) ? fallbackStatus : split?.stage ?? DEFAULT_MARKETING_NOTE_STATUS);
  return {
    phone: String(data.phone ?? fallbackPhone),
    session_id: String(data.session_id ?? ""),
    business_name: String(data.business_name ?? ""),
    link: String(data.link ?? ""),
    notes: String(data.notes ?? ""),
    status: stage,
    relevance: split?.relevance ?? fallbackRelevance ?? "relevant",
    conversation_at: toDateOnly(data.conversation_at),
    updated_at: data.updated_at ? String(data.updated_at) : null,
  };
}

function isMissingRelevanceColumn(message: string): boolean {
  return /relevance|schema cache|column/i.test(message);
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const phoneRaw = req.nextUrl.searchParams.get("phone")?.trim() ?? "";
  const sessionId = req.nextUrl.searchParams.get("session_id")?.trim() ?? "";
  const phone = resolvePhoneKey(phoneRaw, sessionId);
  if (!phone) {
    return NextResponse.json({ error: "missing_phone" }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    let { data, error } = await admin
      .from("marketing_conversation_notes")
      .select(NOTE_SELECT)
      .eq("phone", phone)
      .maybeSingle();

    if (error && isMissingRelevanceColumn(error.message)) {
      console.warn("[marketing/conversation-notes] relevance column missing — run supabase/marketing_admin_status_layers.sql");
      const legacy = await admin
        .from("marketing_conversation_notes")
        .select(NOTE_SELECT_LEGACY)
        .eq("phone", phone)
        .maybeSingle();
      data = legacy.data as typeof data;
      error = legacy.error;
    }

    if (error) {
      console.error("[marketing/conversation-notes] GET failed:", error.message);
      return NextResponse.json({ error: "load_failed", detail: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({
        phone,
        note: {
          phone,
          session_id: sessionId || canonicalMarketingSessionId(phone),
          business_name: "",
          link: "",
          notes: "",
          status: DEFAULT_MARKETING_NOTE_STATUS,
          relevance: "relevant" as const,
          conversation_at: null,
          updated_at: null,
        },
        exists: false,
      });
    }

    return NextResponse.json({
      phone,
      note: serializeNote(data, phone),
      exists: true,
    });
  } catch (e) {
    console.error("[marketing/conversation-notes] GET exception:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "load_failed" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    phone?: string;
    session_id?: string;
    business_name?: string;
    link?: string;
    notes?: string;
    status?: string;
    relevance?: string;
    conversation_at?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sessionId = String(body.session_id ?? "").trim();
  const phone = resolvePhoneKey(String(body.phone ?? ""), sessionId);
  if (!phone) {
    return NextResponse.json({ error: "missing_phone" }, { status: 400 });
  }

  let businessName = String(body.business_name ?? "").trim().slice(0, 200);
  let link = normalizeLink(body.link);
  let notes = String(body.notes ?? "").slice(0, 10000);
  let conversationAt = toDateOnly(body.conversation_at);
  const canonicalSession = sessionId || canonicalMarketingSessionId(phone);

  try {
    const admin = createSupabaseAdminClient();

    // מגן מפני דריסה בטעות: שמירה עם שדות תוכן ריקים לא מוחקת תוכן קיים
    // (למשל race בטעינת הפאנל + לחיצה על סטטוס בלבד).
    let relevanceColumn = true;
    let existingResult = await admin
      .from("marketing_conversation_notes")
      .select(NOTE_SELECT)
      .eq("phone", phone)
      .maybeSingle();
    if (existingResult.error && isMissingRelevanceColumn(existingResult.error.message)) {
      relevanceColumn = false;
      console.warn("[marketing/conversation-notes] relevance column missing — run supabase/marketing_admin_status_layers.sql");
      existingResult = await admin
        .from("marketing_conversation_notes")
        .select(NOTE_SELECT_LEGACY)
        .eq("phone", phone)
        .maybeSingle();
    }
    if (existingResult.error) {
      console.error("[marketing/conversation-notes] existing lookup failed:", existingResult.error.message);
      return NextResponse.json({ error: "save_failed", detail: existingResult.error.message }, { status: 500 });
    }
    const existing = existingResult.data;

    const stored = splitStoredMarketingStatus({
      status: existing?.status,
      relevance: (existing as { relevance?: string | null } | null)?.relevance,
      hasNote: Boolean(existing),
    });
    const relevance: MarketingRelevance = isMarketingRelevance(body.relevance)
      ? body.relevance
      : body.status === "not_relevant"
        ? "not_relevant"
        : (stored?.relevance ?? "relevant");
    const status: MarketingStage = isMarketingStage(body.status)
      ? body.status
      : (stored?.stage ?? "in_process");

    if (existing) {
      const hadContent = Boolean(
        String(existing.business_name ?? "").trim() ||
          String(existing.link ?? "").trim() ||
          String(existing.notes ?? "").trim()
      );
      const incomingEmpty = !businessName && !link && !notes;
      if (hadContent && incomingEmpty) {
        console.warn(
          "[marketing/conversation-notes] blocked empty wipe for phone=%s — preserving content",
          phone
        );
        businessName = String(existing.business_name ?? "");
        link = String(existing.link ?? "");
        notes = String(existing.notes ?? "");
        if (!conversationAt) conversationAt = toDateOnly(existing.conversation_at);
      }

      // שמירת גרסה קודמת לפני דריסה (אם היה תוכן שונה)
      const prevNotes = String(existing.notes ?? "");
      const contentChanging =
        String(existing.business_name ?? "") !== businessName ||
        String(existing.link ?? "") !== link ||
        prevNotes !== notes;
      if (hadContent && contentChanging) {
        const { error: histErr } = await admin.from("marketing_conversation_notes_history").insert({
          phone,
          session_id: String(existing.session_id ?? canonicalSession),
          business_name: String(existing.business_name ?? ""),
          link: String(existing.link ?? ""),
          notes: prevNotes,
          status: coerceMarketingNoteStatus(existing.status),
          conversation_at: toDateOnly(existing.conversation_at),
          saved_at: existing.updated_at || new Date().toISOString(),
        });
        if (histErr) {
          console.error("[marketing/conversation-notes] history insert failed:", histErr.message);
        }
      }
    }

    const payload: Record<string, unknown> = {
      phone,
      session_id: canonicalSession,
      business_name: businessName,
      link,
      notes,
      status,
      conversation_at: conversationAt,
      updated_at: new Date().toISOString(),
    };
    if (relevanceColumn) payload.relevance = relevance;

    let { data, error } = await admin
      .from("marketing_conversation_notes")
      .upsert(payload, { onConflict: "phone" })
      .select(NOTE_SELECT)
      .single();

    if (error && relevanceColumn && isMissingRelevanceColumn(error.message)) {
      console.warn("[marketing/conversation-notes] relevance column missing — run supabase/marketing_admin_status_layers.sql");
      delete payload.relevance;
      const retry = await admin
        .from("marketing_conversation_notes")
        .upsert(payload, { onConflict: "phone" })
        .select(NOTE_SELECT_LEGACY)
        .single();
      data = retry.data as typeof data;
      error = retry.error;
      relevanceColumn = false;
    }

    if (error || !data) {
      console.error("[marketing/conversation-notes] PUT failed:", error?.message ?? "empty_row");
      return NextResponse.json({ error: "save_failed", detail: error?.message ?? "empty_row" }, { status: 500 });
    }

    const column = relevance === "not_relevant" ? "not_relevant" : status;
    if (marketingAdminColumnStopsFollowups(column)) {
      try {
        await markMarketingFollowupOptedOut(phone);
      } catch (e) {
        console.error("[marketing/conversation-notes] followup opt-out failed:", e);
      }
    }

    const { error: pipelineErr } = await admin
      .from("marketing_flow_sessions")
      .update({ pipeline_status: column, updated_at: new Date().toISOString() })
      .eq("phone", phone);
    if (pipelineErr) {
      console.error("[marketing/conversation-notes] pipeline mirror failed:", pipelineErr.message);
    }

    const prevRelevance = stored?.relevance ?? null;
    const prevStage = stored?.stage ?? null;
    if (!existing || prevRelevance !== relevance || prevStage !== status) {
      after(async () => {
        try {
          await syncContactToMetaAudience({ phone, relevance });
        } catch (e) {
          console.error("[marketing/conversation-notes] meta audience sync failed:", e);
        }
      });
    }

    // גם הגרסה החדשה נשמרת להיסטוריה (אם יש תוכן)
    if (businessName || link || notes) {
      const { error: histNewErr } = await admin.from("marketing_conversation_notes_history").insert({
        phone,
        session_id: canonicalSession,
        business_name: businessName,
        link,
        notes,
        status,
        conversation_at: conversationAt,
        saved_at: new Date().toISOString(),
      });
      if (histNewErr) {
        console.error("[marketing/conversation-notes] history new insert failed:", histNewErr.message);
      }
    }

    return NextResponse.json({
      ok: true,
      note: serializeNote(data, phone, status, relevance),
    });
  } catch (e) {
    console.error("[marketing/conversation-notes] PUT exception:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "save_failed" },
      { status: 500 }
    );
  }
}
