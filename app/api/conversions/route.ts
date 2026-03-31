import { NextRequest, NextResponse } from "next/server";
import { logConversion, logMessage } from "@/lib/analytics";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

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

    // If business has Facebook Pixel + CAPI token configured, send a basic S2S event.
    try {
      const admin = createSupabaseAdminClient();
      const { data: biz } = await admin
        .from("businesses")
        .select("facebook_pixel_id, conversions_api_token")
        .eq("slug", businessSlug)
        .maybeSingle();

      const pixelId = biz?.facebook_pixel_id?.trim();
      const capiToken = biz?.conversions_api_token?.trim();

      if (pixelId && capiToken) {
        const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(
          pixelId
        )}/events`;
        const event = {
          data: [
            {
              event_name: "Lead",
              event_time: Math.floor(Date.now() / 1000),
              action_source: "system_generated",
              event_source_url: "", // optional
              custom_data: {
                business_slug: businessSlug,
                session_id: sessionId || null,
                type,
              },
            },
          ],
        };

        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...event,
            access_token: capiToken,
          }),
        }).catch((e) => {
          console.error("[api/conversions] Facebook CAPI forward failed:", e);
        });
      }
    } catch (fbErr) {
      console.error("[api/conversions] Facebook CAPI lookup failed:", fbErr);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/conversions] failed:", e);
    return NextResponse.json({ error: "failed_to_log_conversion" }, { status: 500 });
  }
}
