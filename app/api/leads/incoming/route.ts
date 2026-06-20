import { NextRequest, NextResponse } from "next/server";
import { logMessage } from "@/lib/analytics";
import { verifyLeadsWebhookSecret } from "@/lib/leads/webhook-auth";
import {
  buildTemplateIncomingContactPatch,
  firstNameFromFullName,
  formatLeadTemplateMessageContent,
  leadTemplateUsesFirstName,
  LEAD_TEMPLATE_MODEL,
} from "@/lib/lead-template";
import { dispatchCrmEvent } from "@/lib/crm/dispatch";
import { sendBusinessTemplate } from "@/lib/notifications/sendOwnerNotification";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { buildWaSessionId, normalizePhone } from "@/lib/phone-normalize";

export const runtime = "nodejs";

type IncomingLeadBody = {
  full_name?: unknown;
  phone?: unknown;
  email?: unknown;
  business_slug?: unknown;
};

export async function POST(req: NextRequest) {
  if (!verifyLeadsWebhookSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: IncomingLeadBody;
  try {
    body = (await req.json()) as IncomingLeadBody;
  } catch (e) {
    console.error("[api/leads/incoming] invalid JSON:", e);
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const fullName = String(body.full_name ?? "").trim();
  const businessSlug = String(body.business_slug ?? "").trim().toLowerCase();
  const phoneNorm = normalizePhone(body.phone);

  if (!phoneNorm) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }
  if (!businessSlug) {
    return NextResponse.json({ error: "missing_business_slug" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: business, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, lead_template_name")
    .eq("slug", businessSlug)
    .maybeSingle();

  if (bizErr) {
    console.error("[api/leads/incoming] business lookup failed:", bizErr);
    return NextResponse.json({ error: "business_lookup_failed" }, { status: 500 });
  }
  if (!business?.id) {
    return NextResponse.json({ error: "business_not_found" }, { status: 404 });
  }

  const businessId = Number(business.id);
  if (!Number.isFinite(businessId)) {
    console.error("[api/leads/incoming] invalid business id:", business.id);
    return NextResponse.json({ error: "business_lookup_failed" }, { status: 500 });
  }

  const templateName = String((business as { lead_template_name?: string | null }).lead_template_name ?? "").trim();
  if (!templateName) {
    return NextResponse.json({ error: "no lead template configured" }, { status: 400 });
  }

  const { data: channel, error: channelErr } = await admin
    .from("whatsapp_channels")
    .select("phone_number_id")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (channelErr) {
    console.error("[api/leads/incoming] whatsapp channel lookup failed:", channelErr);
    return NextResponse.json({ error: "channel_lookup_failed" }, { status: 500 });
  }
  if (!channel?.phone_number_id) {
    return NextResponse.json({ error: "whatsapp_channel_not_found" }, { status: 404 });
  }

  const phoneNumberId = String(channel.phone_number_id).trim();
  const nowIso = new Date().toISOString();

  const { error: upsertErr } = await admin.from("contacts").upsert(
    {
      phone: phoneNorm,
      business_id: businessId,
      full_name: fullName || null,
      ...buildTemplateIncomingContactPatch(nowIso),
    },
    { onConflict: "business_id,phone" }
  );

  if (upsertErr) {
    console.error("[api/leads/incoming] contacts upsert failed:", upsertErr);
    return NextResponse.json({ error: "contact_upsert_failed" }, { status: 500 });
  }

  const firstName = firstNameFromFullName(fullName);
  const sendResult = await sendBusinessTemplate({
    to: phoneNorm,
    phoneNumberId,
    templateName,
    languageCode: "he",
    ...(leadTemplateUsesFirstName(templateName)
      ? {
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: firstName }],
            },
          ],
        }
      : {}),
  });

  if (!sendResult.ok) {
    console.error("[api/leads/incoming] template send failed:", sendResult.error);
    return NextResponse.json({ error: "template_send_failed" }, { status: 502 });
  }

  const sessionId = buildWaSessionId(phoneNumberId, phoneNorm);
  await logMessage({
    business_slug: businessSlug,
    role: "assistant",
    content: formatLeadTemplateMessageContent(templateName, { firstName }),
    model_used: LEAD_TEMPLATE_MODEL,
    session_id: sessionId || null,
  });

  void dispatchCrmEvent({
    businessId,
    leadPhone: phoneNorm,
    kind: "template_sent",
    fullName: fullName || null,
    eventAtIso: nowIso,
  });

  return NextResponse.json({ ok: true });
}
