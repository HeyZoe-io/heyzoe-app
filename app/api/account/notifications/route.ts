import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveAccountBusinessForUser } from "@/lib/account/resolve-business";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTING_KEYS,
  NOTIFICATION_UI_SETTING_KEYS,
  type NotificationSettings,
} from "@/lib/notifications/types";
import {
  ensureOwnerNotificationSettingsRow,
  getNotificationSettings,
  upsertNotificationSettings,
} from "@/lib/notifications/getNotificationSettings";

export const runtime = "nodejs";

function parseUiSettingsBody(body: unknown): Partial<NotificationSettings> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out: Partial<NotificationSettings> = {};
  for (const key of NOTIFICATION_UI_SETTING_KEYS) {
    if (typeof b[key] === "boolean") out[key] = b[key];
  }
  if (Object.keys(out).length === 0) return null;
  return out;
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ctx = await resolveAccountBusinessForUser(data.user.id);
  if (!ctx) return NextResponse.json({ error: "no_business" }, { status: 404 });

  const settings = ctx.ownerWhatsappOptedIn
    ? await ensureOwnerNotificationSettingsRow(ctx.businessId)
    : await getNotificationSettings(ctx.businessId);

  return NextResponse.json({
    ok: true,
    business_id: ctx.businessId,
    slug: ctx.slug,
    owner_whatsapp_opted_in: ctx.ownerWhatsappOptedIn,
    owner_whatsapp_phone: ctx.ownerWhatsappPhone,
    settings,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ctx = await resolveAccountBusinessForUser(data.user.id);
  if (!ctx) return NextResponse.json({ error: "no_business" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const uiPatch = parseUiSettingsBody(body);
  if (!uiPatch) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const existing = await getNotificationSettings(ctx.businessId);
  const merged = { ...existing, ...uiPatch } as NotificationSettings;
  for (const key of NOTIFICATION_SETTING_KEYS) {
    if (typeof merged[key] !== "boolean") merged[key] = DEFAULT_NOTIFICATION_SETTINGS[key];
  }

  const result = await upsertNotificationSettings(ctx.businessId, merged);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "save_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    settings: merged,
    owner_whatsapp_opted_in: ctx.ownerWhatsappOptedIn,
  });
}
