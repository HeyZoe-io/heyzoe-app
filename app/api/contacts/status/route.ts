import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isBusinessSubscriptionActive } from "@/lib/notifications/business-notification-eligibility";
import { assertBusinessAccess } from "@/lib/dashboard-business-access";
import { markContactNotRelevantManually } from "@/lib/not-relevant";
import { markContactHumanRequestedManually } from "@/lib/human-requested";
import { markContactTrialRegisteredManually } from "@/lib/trial-registered-manual";
import { markContactNoResponseManually } from "@/lib/wa-no-response";
import { contactPhoneLookupVariants } from "@/lib/phone-normalize";

export const runtime = "nodejs";

type Body = {
  business_slug?: string;
  phone?: string;
  status?: string;
  reason?: string | null;
};

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const businessSlug = String(body.business_slug ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  const status = String(body.status ?? "").trim().toLowerCase();

  if (!businessSlug) return NextResponse.json({ error: "missing_business_slug" }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "missing_phone" }, { status: 400 });
  if (
    status !== "not_relevant" &&
    status !== "registered" &&
    status !== "human_requested" &&
    status !== "no_response"
  ) {
    return NextResponse.json({ error: "unsupported_status" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const access = await assertBusinessAccess(admin, { id: user.id, email: user.email }, businessSlug);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (!isBusinessSubscriptionActive(access.business)) {
    return NextResponse.json({ error: "subscription_inactive" }, { status: 403 });
  }

  const businessId = access.business.id;
  const phoneVariants = contactPhoneLookupVariants(phone);

  const lookupPhones = phoneVariants.length ? phoneVariants : [phone];
  let { data: existingRows, error: existingErr } = await admin
    .from("contacts")
    .select("full_name, not_relevant_at, human_requested_at, wa_no_response_at, opted_out, phone, trial_registered, session_phase")
    .eq("business_id", businessId)
    .in("phone", lookupPhones)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (existingErr && /human_requested_at|column/i.test(String(existingErr.message ?? ""))) {
    if (status === "human_requested") {
      console.error("[api/contacts/status] human_requested_at column missing — run migration");
      return NextResponse.json({ error: "migration_required" }, { status: 503 });
    }
    console.warn("[api/contacts/status] human_requested_at missing — fallback lookup");
    const fallback = await admin
      .from("contacts")
      .select("full_name, not_relevant_at, opted_out, phone, trial_registered, session_phase")
      .eq("business_id", businessId)
      .in("phone", lookupPhones)
      .order("updated_at", { ascending: false })
      .limit(1);
    existingRows = fallback.data as typeof existingRows;
    existingErr = fallback.error;
  }

  if (existingErr) {
    console.error("[api/contacts/status] contact lookup failed:", existingErr.message);
    return NextResponse.json({ error: "contact_lookup_failed" }, { status: 500 });
  }

  const existing = existingRows?.[0];
  if (!existing) {
    return NextResponse.json({ error: "contact_not_found" }, { status: 404 });
  }
  if ((existing as { opted_out?: boolean }).opted_out === true) {
    return NextResponse.json({ error: "contact_opted_out" }, { status: 400 });
  }

  const canonicalPhone = String((existing as { phone?: string }).phone ?? phone);

  if (status === "not_relevant") {
    if ((existing as { not_relevant_at?: string | null }).not_relevant_at) {
      return NextResponse.json({ ok: true, already: true });
    }

    const result = await markContactNotRelevantManually({
      admin,
      businessId,
      businessSlug,
      phone: canonicalPhone,
      reason: body.reason ?? null,
      fullName: (existing as { full_name?: string | null }).full_name ?? null,
    });

    if (!result.ok) {
      const httpStatus = result.error === "contact_not_found" ? 404 : 500;
      return NextResponse.json({ error: result.error }, { status: httpStatus });
    }

    return NextResponse.json({
      ok: true,
      status: "not_relevant",
      not_relevant_at: result.not_relevant_at,
    });
  }

  if (status === "no_response") {
    if ((existing as { not_relevant_at?: string | null }).not_relevant_at) {
      return NextResponse.json({ error: "contact_not_relevant" }, { status: 400 });
    }
    if ((existing as { human_requested_at?: string | null }).human_requested_at) {
      return NextResponse.json({ error: "contact_human_requested" }, { status: 400 });
    }
    const alreadyRegistered =
      (existing as { trial_registered?: boolean | null }).trial_registered === true ||
      String((existing as { session_phase?: string | null }).session_phase ?? "").trim() === "registered";
    if (alreadyRegistered) {
      return NextResponse.json({ error: "contact_registered" }, { status: 400 });
    }

    const result = await markContactNoResponseManually({
      admin,
      businessId,
      businessSlug,
      phone: canonicalPhone,
      fullName: (existing as { full_name?: string | null }).full_name ?? null,
    });

    if (!result.ok) {
      const httpStatus = result.error === "contact_not_found" ? 404 : 500;
      return NextResponse.json({ error: result.error }, { status: httpStatus });
    }

    return NextResponse.json({
      ok: true,
      status: "no_response",
      wa_no_response_at: result.wa_no_response_at,
      already: result.already === true,
    });
  }

  if (status === "human_requested") {
    if ((existing as { human_requested_at?: string | null }).human_requested_at) {
      return NextResponse.json({ ok: true, already: true });
    }
    if ((existing as { not_relevant_at?: string | null }).not_relevant_at) {
      return NextResponse.json({ error: "contact_not_relevant" }, { status: 400 });
    }

    const result = await markContactHumanRequestedManually({
      admin,
      businessId,
      businessSlug,
      phone: canonicalPhone,
      fullName: (existing as { full_name?: string | null }).full_name ?? null,
    });

    if (!result.ok) {
      const httpStatus = result.error === "contact_not_found" ? 404 : 500;
      return NextResponse.json({ error: result.error }, { status: httpStatus });
    }

    return NextResponse.json({
      ok: true,
      status: "human_requested",
      human_requested_at: result.human_requested_at,
    });
  }

  const alreadyRegistered =
    (existing as { trial_registered?: boolean | null }).trial_registered === true ||
    String((existing as { session_phase?: string | null }).session_phase ?? "").trim() === "registered";
  if (alreadyRegistered) {
    return NextResponse.json({ ok: true, already: true });
  }
  if ((existing as { not_relevant_at?: string | null }).not_relevant_at) {
    return NextResponse.json({ error: "contact_not_relevant" }, { status: 400 });
  }
  if ((existing as { wa_no_response_at?: string | null }).wa_no_response_at) {
    return NextResponse.json({ error: "contact_no_response" }, { status: 400 });
  }
  if ((existing as { human_requested_at?: string | null }).human_requested_at) {
    return NextResponse.json({ error: "contact_human_requested" }, { status: 400 });
  }

  const result = await markContactTrialRegisteredManually({
    admin,
    businessId,
    businessSlug,
    phone: canonicalPhone,
    fullName: (existing as { full_name?: string | null }).full_name ?? null,
  });

  if (!result.ok) {
    const httpStatus = result.error === "contact_not_found" ? 404 : 500;
    return NextResponse.json({ error: result.error }, { status: httpStatus });
  }

  return NextResponse.json({
    ok: true,
    status: "registered",
    trial_registered_at: result.trial_registered_at,
  });
}
