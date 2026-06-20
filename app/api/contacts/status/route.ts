import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isBusinessSubscriptionActive } from "@/lib/notifications/business-notification-eligibility";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { markContactNotRelevantManually } from "@/lib/not-relevant";
import { markContactHumanRequestedManually } from "@/lib/human-requested";
import { markContactTrialRegisteredManually } from "@/lib/trial-registered-manual";
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

async function requireBusinessAccess(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  slug: string,
  userEmail?: string | null
) {
  const slugNorm = String(slug ?? "").trim().toLowerCase();
  if (!slugNorm) return { ok: false as const, error: "missing_business_slug" as const };

  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, user_id, is_active")
    .eq("slug", slugNorm)
    .maybeSingle();

  if (bizErr) return { ok: false as const, error: "business_lookup_failed" as const };
  if (!biz?.id) return { ok: false as const, error: "business_not_found" as const };
  if (!isBusinessSubscriptionActive(biz as { is_active?: boolean | null })) {
    return { ok: false as const, error: "subscription_inactive" as const };
  }

  if (isAdminAllowedEmail(String(userEmail ?? "").trim().toLowerCase())) {
    return { ok: true as const, business: biz as { id: number; slug: string; user_id: string } };
  }

  const ownerOk = String(biz.user_id ?? "") === userId;
  if (ownerOk) return { ok: true as const, business: biz as { id: number; slug: string; user_id: string } };

  const { data: membership, error: memErr } = await admin
    .from("business_users")
    .select("business_id")
    .eq("user_id", userId)
    .eq("business_id", biz.id)
    .maybeSingle();

  if (memErr) return { ok: false as const, error: "business_access_check_failed" as const };
  if (!membership) return { ok: false as const, error: "forbidden" as const };

  return { ok: true as const, business: biz as { id: number; slug: string; user_id: string } };
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
  if (status !== "not_relevant" && status !== "registered" && status !== "human_requested") {
    return NextResponse.json({ error: "unsupported_status" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const access = await requireBusinessAccess(admin, user.id, businessSlug, user.email);
  if (!access.ok) {
    const httpStatus =
      access.error === "forbidden" || access.error === "subscription_inactive"
        ? 403
        : access.error === "business_not_found"
          ? 404
          : 400;
    return NextResponse.json({ error: access.error }, { status: httpStatus });
  }

  const businessId = access.business.id;
  const phoneVariants = contactPhoneLookupVariants(phone);

  const { data: existingRows, error: existingErr } = await admin
    .from("contacts")
    .select("full_name, not_relevant_at, human_requested_at, opted_out, phone, trial_registered, session_phase")
    .eq("business_id", businessId)
    .in("phone", phoneVariants.length ? phoneVariants : [phone])
    .order("updated_at", { ascending: false })
    .limit(1);

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
