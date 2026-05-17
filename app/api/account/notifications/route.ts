import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveAccountBusinessForUser } from "@/lib/account/resolve-business";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTING_KEYS,
  type NotificationSettings,
} from "@/lib/notifications/types";
import {
  getNotificationSettings,
  upsertNotificationSettings,
} from "@/lib/notifications/getNotificationSettings";

export const runtime = "nodejs";

function parseSettingsBody(body: unknown): NotificationSettings | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out = { ...DEFAULT_NOTIFICATION_SETTINGS };
  for (const key of NOTIFICATION_SETTING_KEYS) {
    if (typeof b[key] === "boolean") out[key] = b[key];
  }
  return out;
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ctx = await resolveAccountBusinessForUser(data.user.id);
  if (!ctx) return NextResponse.json({ error: "no_business" }, { status: 404 });

  const settings = await getNotificationSettings(ctx.businessId);
  return NextResponse.json({
    ok: true,
    business_id: ctx.businessId,
    slug: ctx.slug,
    owner_whatsapp_opted_in: ctx.ownerWhatsappOptedIn,
    settings,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ctx = await resolveAccountBusinessForUser(data.user.id);
  if (!ctx) return NextResponse.json({ error: "no_business" }, { status: 404 });

  if (!ctx.ownerWhatsappOptedIn) {
    return NextResponse.json({ error: "owner_whatsapp_not_connected" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const settings = parseSettingsBody(body);
  if (!settings) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const result = await upsertNotificationSettings(ctx.businessId, settings);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, settings, owner_whatsapp_opted_in: true });
}
