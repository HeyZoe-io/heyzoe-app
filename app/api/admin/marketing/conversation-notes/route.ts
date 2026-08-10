import { after, NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { normalizePhone } from "@/lib/phone-normalize";
import {
  coerceMarketingNoteStatus,
  DEFAULT_MARKETING_NOTE_STATUS,
  isMarketingNoteStatus,
  type MarketingNoteStatus,
} from "@/lib/marketing-conversation-notes";
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
    conversation_at?: string | null;
    updated_at?: string | null;
  },
  fallbackPhone: string,
  fallbackStatus?: NoteStatus
) {
  return {
    phone: String(data.phone ?? fallbackPhone),
    session_id: String(data.session_id ?? ""),
    business_name: String(data.business_name ?? ""),
    link: String(data.link ?? ""),
    notes: String(data.notes ?? ""),
    status: isMarketingNoteStatus(data.status) ? data.status : (fallbackStatus ?? DEFAULT_MARKETING_NOTE_STATUS),
    conversation_at: toDateOnly(data.conversation_at),
    updated_at: data.updated_at ? String(data.updated_at) : null,
  };
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
    const { data, error } = await admin
      .from("marketing_conversation_notes")
      .select(NOTE_SELECT)
      .eq("phone", phone)
      .maybeSingle();

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

  const status: NoteStatus = coerceMarketingNoteStatus(body.status);
  let businessName = String(body.business_name ?? "").trim().slice(0, 200);
  let link = normalizeLink(body.link);
  let notes = String(body.notes ?? "").slice(0, 10000);
  let conversationAt = toDateOnly(body.conversation_at);
  const canonicalSession = sessionId || canonicalMarketingSessionId(phone);

  try {
    const admin = createSupabaseAdminClient();

    // מגן מפני דריסה בטעות: שמירה עם שדות תוכן ריקים לא מוחקת תוכן קיים
    // (למשל race בטעינת הפאנל + לחיצה על סטטוס בלבד).
    const { data: existing } = await admin
      .from("marketing_conversation_notes")
      .select(NOTE_SELECT)
      .eq("phone", phone)
      .maybeSingle();
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

    const { data, error } = await admin
      .from("marketing_conversation_notes")
      .upsert(
        {
          phone,
          session_id: canonicalSession,
          business_name: businessName,
          link,
          notes,
          status,
          conversation_at: conversationAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "phone" }
      )
      .select(NOTE_SELECT)
      .single();

    if (error) {
      console.error("[marketing/conversation-notes] PUT failed:", error.message);
      return NextResponse.json({ error: "save_failed", detail: error.message }, { status: 500 });
    }

    // סימון «לא רלוונטי» / «לא מעוניין» — עוצר פולואפים אוטומטיים של קו השיווק
    if (status === "not_relevant" || status === "not_interested") {
      try {
        await markMarketingFollowupOptedOut(phone);
      } catch (e) {
        console.error("[marketing/conversation-notes] followup opt-out failed:", e);
      }
    }

    // Meta Custom Audiences — רק כשהסטטוס באמת השתנה; fire-and-forget (לא חוסם את תשובת ה-PUT)
    const prevStatus = existing
      ? coerceMarketingNoteStatus(existing.status)
      : null;
    if (prevStatus !== status) {
      after(async () => {
        try {
          const result = await syncContactToMetaAudience({ phone, status });
          // TEMP debug — remove after Meta sync verification
          const last4 = result.phoneForHash
            ? result.phoneForHash.slice(-4)
            : String(phone).replace(/\D/g, "").slice(-4) || "?";
          if (result.reason === "null_status") {
            console.log("[meta-audiences:temp] no-op (null status)", { last4, status });
          } else if (result.reason === "same_bucket" || result.skipped) {
            console.log("[meta-audiences:temp] skipped (same bucket)", {
              last4,
              phoneForHash: result.phoneForHash,
              bucket: result.bucket,
              status,
            });
          } else {
            console.log("[meta-audiences:temp] sync result", {
              last4,
              phoneForHash: result.phoneForHash,
              bucket: result.bucket,
              status,
              ok: result.ok,
              reason: result.reason,
              add: result.addMeta,
              remove: result.removeMeta,
              error: result.error,
            });
          }
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
      note: serializeNote(data, phone, status),
    });
  } catch (e) {
    console.error("[marketing/conversation-notes] PUT exception:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "save_failed" },
      { status: 500 }
    );
  }
}
