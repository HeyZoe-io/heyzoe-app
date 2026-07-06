import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  resolveAccountBusinessForUser,
  resolveAccountBusinessForUserBySlug,
} from "@/lib/account/resolve-business";
import { normDashboardSlug } from "@/lib/dashboard-business-access";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SETTING_KEYS,
  NOTIFICATION_UI_SETTING_KEYS,
  WHATSAPP_NOTIFICATION_SETTING_KEYS,
  type NotificationSettings,
} from "@/lib/notifications/types";
import {
  ensureOwnerNotificationSettingsRow,
  getNotificationSettings,
  upsertNotificationSettings,
} from "@/lib/notifications/getNotificationSettings";
import {
  normalizeOwnerNotificationEmailInput,
  resolveOwnerNotificationEmail,
} from "@/lib/notifications/resolveOwnerNotificationEmail";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

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

function parseOwnerNotificationEmailPatch(body: unknown): string | null | undefined {
  if (!body || typeof body !== "object") return undefined;
  if (!Object.prototype.hasOwnProperty.call(body, "owner_notification_email")) return undefined;
  return normalizeOwnerNotificationEmailInput(
    (body as Record<string, unknown>).owner_notification_email
  );
}

async function loadBusinessEmails(businessId: number) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("businesses")
    .select("email, owner_notification_email")
    .eq("id", businessId)
    .maybeSingle();
  if (error || !data) {
    return { owner_notification_email: "", business_email: "", effective_email: "" };
  }
  const row = data as { email?: string | null; owner_notification_email?: string | null };
  const owner_notification_email = String(row.owner_notification_email ?? "").trim();
  const business_email = String(row.email ?? "").trim();
  return {
    owner_notification_email,
    business_email,
    effective_email: resolveOwnerNotificationEmail(row),
  };
}

async function resolveNotificationsContext(user: { id: string; email?: string | null }, slugParam?: string) {
  const slug = normDashboardSlug(slugParam ?? "");
  if (slug) {
    return resolveAccountBusinessForUserBySlug(user.id, slug, { userEmail: user.email });
  }
  return resolveAccountBusinessForUser(user.id);
}

function normalizeSettingsForResponse(
  settings: NotificationSettings,
  ownerWhatsappOptedIn: boolean
): NotificationSettings {
  if (ownerWhatsappOptedIn) return settings;
  const out = { ...settings };
  for (const key of WHATSAPP_NOTIFICATION_SETTING_KEYS) {
    out[key] = false;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slugParam = req.nextUrl.searchParams.get("slug") ?? "";
  const ctx = await resolveNotificationsContext(data.user, slugParam);
  if (!ctx) return NextResponse.json({ error: "no_business" }, { status: 404 });

  const settings = normalizeSettingsForResponse(
    ctx.ownerWhatsappOptedIn
      ? await ensureOwnerNotificationSettingsRow(ctx.businessId)
      : await getNotificationSettings(ctx.businessId),
    ctx.ownerWhatsappOptedIn
  );

  const emails = await loadBusinessEmails(ctx.businessId);

  return NextResponse.json({
    ok: true,
    business_id: ctx.businessId,
    slug: ctx.slug,
    owner_whatsapp_opted_in: ctx.ownerWhatsappOptedIn,
    owner_whatsapp_phone: ctx.ownerWhatsappPhone,
    settings,
    ...emails,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const slugFromBody =
    body && typeof body === "object" && typeof (body as { slug?: unknown }).slug === "string"
      ? String((body as { slug: string }).slug)
      : "";
  const slugParam = req.nextUrl.searchParams.get("slug") ?? slugFromBody;
  const ctx = await resolveNotificationsContext(data.user, slugParam);
  if (!ctx) return NextResponse.json({ error: "no_business" }, { status: 404 });

  const uiPatch = parseUiSettingsBody(body);
  const emailPatch = parseOwnerNotificationEmailPatch(body);
  if (!uiPatch && emailPatch === undefined) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (emailPatch === null) {
    return NextResponse.json({ error: "invalid_notification_email" }, { status: 400 });
  }

  const existing = await getNotificationSettings(ctx.businessId);
  const merged = { ...existing, ...uiPatch } as NotificationSettings;
  for (const key of NOTIFICATION_SETTING_KEYS) {
    if (typeof merged[key] !== "boolean") merged[key] = DEFAULT_NOTIFICATION_SETTINGS[key];
  }
  if (!ctx.ownerWhatsappOptedIn) {
    for (const key of WHATSAPP_NOTIFICATION_SETTING_KEYS) {
      merged[key] = false;
    }
  }

  if (uiPatch) {
    const result = await upsertNotificationSettings(ctx.businessId, merged);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "save_failed" }, { status: 500 });
    }
  }

  if (emailPatch !== undefined) {
    const admin = createSupabaseAdminClient();
    const { error: emailErr } = await admin
      .from("businesses")
      .update({ owner_notification_email: emailPatch || null })
      .eq("id", ctx.businessId);
    if (emailErr) {
      const missingCol = /owner_notification_email|column/i.test(String(emailErr.message ?? ""));
      return NextResponse.json(
        {
          error: missingCol
            ? "missing_db_column_owner_notification_email"
            : emailErr.message ?? "email_save_failed",
        },
        { status: 500 }
      );
    }
  }

  const emails = await loadBusinessEmails(ctx.businessId);

  return NextResponse.json({
    ok: true,
    settings: normalizeSettingsForResponse(merged, ctx.ownerWhatsappOptedIn),
    owner_whatsapp_opted_in: ctx.ownerWhatsappOptedIn,
    ...emails,
  });
}
