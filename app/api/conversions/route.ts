import { NextRequest, NextResponse } from "next/server";
import { logConversion, logMessage } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessSlug = typeof body.business_slug === "string" ? body.business_slug.trim() : "";
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const type = typeof body.type === "string" ? body.type.trim() : "cta_click";

    if (!businessSlug) {
      return NextResponse.json({ error: "missing business_slug" }, { status: 400 });
    }

    await logConversion({
      business_slug: businessSlug,
      session_id: sessionId || null,
      type,
    });

    // Keep a mirrored event in messages for easier timeline/debug per session.
    await logMessage({
      business_slug: businessSlug,
      role: "event",
      content: `conversion:${type}`,
      session_id: sessionId || null,
      model_used: null,
      error_code: null,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/conversions] failed:", e);
    return NextResponse.json({ error: "failed_to_log_conversion" }, { status: 500 });
  }
}
