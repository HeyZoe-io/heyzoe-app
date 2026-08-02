import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { normalizePhone } from "@/lib/phone-normalize";
import {
  canonicalMarketingSessionId,
  extractLeadPhoneFromMarketingSession,
} from "@/lib/marketing-whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["in_process", "not_relevant", "registered", "no_response"] as const;
type NoteStatus = (typeof STATUSES)[number];

const NOTE_SELECT =
  "phone, session_id, business_name, link, notes, status, conversation_at, updated_at";

function isNoteStatus(v: unknown): v is NoteStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

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
    status: isNoteStatus(data.status) ? data.status : (fallbackStatus ?? "in_process"),
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
          status: "in_process" as NoteStatus,
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

  const status: NoteStatus = isNoteStatus(body.status) ? body.status : "in_process";
  const businessName = String(body.business_name ?? "").trim().slice(0, 200);
  const link = normalizeLink(body.link);
  const notes = String(body.notes ?? "").slice(0, 10000);
  const conversationAt = toDateOnly(body.conversation_at);
  const canonicalSession = sessionId || canonicalMarketingSessionId(phone);

  try {
    const admin = createSupabaseAdminClient();
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
