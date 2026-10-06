import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { authorizeZoeAdminCalendarToken } from "@/lib/zoe-admin-calendar";
import { buildZoeAdminCalendarFeed } from "@/lib/zoe-admin-calendar-feed";

/**
 * יומן מנוי לשיחות זואי אדמין (שיחת הקמה / דורש שיחה).
 * Google Calendar מושך את הכתובת בעצמו — אין cron ואין רשומה ב-vercel.json.
 * הוספה: יומן Google של office@heyzoe.io → הוספת יומן → מכתובת URL.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!authorizeZoeAdminCalendarToken(token)) {
    console.error("[calendar/zoe-admin] unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const { ics, count } = await buildZoeAdminCalendarFeed(admin);
    console.info("[calendar/zoe-admin] feed ok", { count });
    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="zoe-admin.ics"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "feed_failed";
    console.error("[calendar/zoe-admin] feed failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
