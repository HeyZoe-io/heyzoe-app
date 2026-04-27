import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const ALLOWED_EVENT_TYPES = new Set([
  "pageview",
  "cta_click",
  "chat_open",
  "checkout_start",
  "purchase",
]);

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as any;
    const event_type = typeof body?.event_type === "string" ? body.event_type.trim() : "";
    const source = typeof body?.source === "string" ? body.source.trim().slice(0, 120) : null;
    const session_id = typeof body?.session_id === "string" ? body.session_id.trim().slice(0, 180) : "";

    const valueRaw = body?.value;
    const value =
      valueRaw == null || valueRaw === ""
        ? null
        : typeof valueRaw === "number"
          ? valueRaw
          : Number(String(valueRaw));

    if (!ALLOWED_EVENT_TYPES.has(event_type)) {
      return withCors(NextResponse.json({ ok: false, error: "invalid_event_type" }, { status: 400 }));
    }
    if (!session_id) {
      return withCors(NextResponse.json({ ok: false, error: "missing_session_id" }, { status: 400 }));
    }
    if (event_type === "purchase") {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return withCors(NextResponse.json({ ok: false, error: "invalid_value" }, { status: 400 }));
      }
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("analytics_events").insert({
      event_type,
      value: event_type === "purchase" ? value : null,
      source,
      session_id,
    });

    if (error) {
      return withCors(NextResponse.json({ ok: false, error: error.message }, { status: 500 }));
    }

    return withCors(NextResponse.json({ ok: true }));
  } catch (e) {
    console.error("[api/track] failed:", e);
    return withCors(NextResponse.json({ ok: false, error: "track_failed" }, { status: 500 }));
  }
}

