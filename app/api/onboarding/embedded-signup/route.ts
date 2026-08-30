import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  subscribeWabaToAppWebhooks,
  fetchPhoneNumbersForWaba,
  registerMetaPhoneNumberWithPin,
  type MetaWabaPhoneNumber,
} from "@/lib/meta-waba-resolve";
import { canWriteForSlug } from "@/lib/onboarding-auth";
import {
  pickWabaPhone,
  shouldUseExistingNumberConnect,
} from "@/lib/wa-existing-number-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeSlug(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
}

function normalizeEmail(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

export async function POST(req: NextRequest) {
  let body: {
    code?: unknown;
    waba_id?: unknown;
    phone_number_id?: unknown;
    businessSlug?: unknown;
    email?: unknown;
    onboarding_type?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const code = String(body.code ?? "").trim();
  const waba_id = String(body.waba_id ?? "").trim().replace(/\s+/g, "");
  const phone_number_id = String(body.phone_number_id ?? "").trim().replace(/\s+/g, "");
  const businessSlug = normalizeSlug(body.businessSlug);
  const proofEmail = normalizeEmail(body.email);
  const requestedOnboardingType = String(body.onboarding_type ?? "").trim();

  if (!businessSlug) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!waba_id) {
    return NextResponse.json({ error: "waba_id is required and must not be empty" }, { status: 400 });
  }

  console.info(
    `[embedded-signup] received waba_id=${waba_id}, phone_number_id=${phone_number_id || "(none)"}, requested_type=${requestedOnboardingType || "(none)"}`
  );

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  const admin = createSupabaseAdminClient();
  const allowed = await canWriteForSlug(admin, businessSlug, userId, proofEmail);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let storedOnboardingType = "";
  try {
    const { data: bizType } = await admin
      .from("businesses")
      .select("onboarding_type")
      .eq("slug", businessSlug)
      .maybeSingle();
    storedOnboardingType = String(
      (bizType as { onboarding_type?: unknown } | null)?.onboarding_type ?? ""
    ).trim();
  } catch {
    storedOnboardingType = "";
  }

  const systemToken = process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ?? "";
  let metaNumbers: MetaWabaPhoneNumber[] = [];
  if (systemToken) {
    try {
      metaNumbers = await fetchPhoneNumbersForWaba(waba_id, systemToken);
    } catch (e) {
      console.warn("[embedded-signup] fetchPhoneNumbersForWaba failed; will infer from client ids", {
        waba_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const isCoexistence = shouldUseExistingNumberConnect({
    storedOnboardingType,
    requestedOnboardingType,
    phoneNumberIdFromClient: phone_number_id,
    metaPhoneCount: metaNumbers.length,
  });

  const picked = pickWabaPhone(metaNumbers, phone_number_id);
  const effectivePhoneNumberId = picked?.phoneNumberId || phone_number_id;
  const effectivePhoneDisplay = picked?.phoneDisplay ?? null;

  const businessPatch: Record<string, unknown> = {
    waba_id,
    updated_at: new Date().toISOString(),
  };
  if (isCoexistence && storedOnboardingType !== "coexistence") {
    businessPatch.onboarding_type = "coexistence";
  }
  if (effectivePhoneDisplay) {
    businessPatch.whatsapp_number = effectivePhoneDisplay;
  }

  const { error } = await admin
    .from("businesses")
    .update(businessPatch as any)
    .eq("slug", businessSlug);

  if (error) {
    if (/waba_id|column/i.test(error.message)) {
      return NextResponse.json(
        {
          error:
            "חסרה עמודת waba_id בטבלת businesses. הריצו ב-Supabase: supabase/businesses_waba_id.sql",
        },
        { status: 400 }
      );
    }
    console.error("[embedded-signup] update failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.info(
    `[embedded-signup] updated businesses.waba_id for slug=${businessSlug} coexistence=${isCoexistence} phone_display=${effectivePhoneDisplay || "(none)"}`
  );

  const { data: bizForRelease, error: bizReleaseErr } = await admin
    .from("businesses")
    .select("id")
    .eq("slug", businessSlug)
    .maybeSingle();

  if (bizReleaseErr) {
    console.warn("[embedded-signup] wa_provision_jobs release skipped: business lookup failed", {
      slug: businessSlug,
      error: bizReleaseErr.message,
    });
  } else if (bizForRelease?.id) {
    const businessId = Number((bizForRelease as { id?: unknown }).id);
    if (!isCoexistence) {
      const { data: releasedJobs, error: releaseErr } = await admin
        .from("wa_provision_jobs")
        .update({ status: "queued", updated_at: new Date().toISOString() } as any)
        .eq("business_id", businessId)
        .eq("status", "awaiting_waba")
        .select("id");
      if (releaseErr) {
        console.error("[embedded-signup] release wa_provision_jobs failed:", releaseErr.message);
      } else if (releasedJobs?.length) {
        console.info(
          `[embedded-signup] released wa_provision_jobs from awaiting_waba to queued for business_id=${businessId}`
        );
      }
    } else {
      console.info(
        `[embedded-signup] coexistence: skipping wa_provision_jobs release for business_id=${businessId}`
      );
    }
  }

  let webhookSubscribed = false;
  let webhookError: string | undefined;
  try {
    if (systemToken && waba_id) {
      await subscribeWabaToAppWebhooks(waba_id, systemToken);
      webhookSubscribed = true;
      console.log(`[embedded-signup] subscribed_apps success for waba_id=${waba_id}`);
    } else {
      webhookError = "missing_system_token";
    }
  } catch (e) {
    webhookError = e instanceof Error ? e.message : String(e);
    console.error("[embedded-signup] subscribed_apps failed:", e);
    // לא לחסום את הflow - webhook הוא fallback
  }

  if (isCoexistence && !effectivePhoneNumberId) {
    console.warn(
      `[embedded-signup] coexistence: no phone numbers on WABA yet waba_id=${waba_id}; PARTNER_ADDED will self-heal`
    );
  }

  if (effectivePhoneNumberId) {
    if (!bizForRelease?.id) {
      console.warn("[embedded-signup] whatsapp_channels upsert skipped: business lookup failed", {
        slug: businessSlug,
        error: bizReleaseErr?.message ?? "business_not_found",
      });
    } else {
      const { error: channelErr } = await admin.from("whatsapp_channels").upsert(
        {
          business_id: bizForRelease.id,
          business_slug: businessSlug,
          phone_number_id: effectivePhoneNumberId,
          is_active: isCoexistence ? true : false,
          provisioning_status: isCoexistence ? "active" : "pending",
          ...(effectivePhoneDisplay ? { phone_display: effectivePhoneDisplay } : {}),
        } as any,
        { onConflict: "phone_number_id" }
      );

      if (channelErr) {
        console.warn("[embedded-signup] whatsapp_channels upsert failed (waba_id saved):", {
          slug: businessSlug,
          phone_number_id: effectivePhoneNumberId,
          error: channelErr.message,
        });
      } else {
        console.info(`[embedded-signup] upserted whatsapp_channels for phone_number_id=${effectivePhoneNumberId}`);
      }

      if (isCoexistence) {
        if (systemToken) {
          const reg = await registerMetaPhoneNumberWithPin(effectivePhoneNumberId, systemToken, {
            logPrefix: "[embedded-signup]",
          });
          if (!reg.ok) {
            console.error("[embedded-signup] coexistence /register failed:", {
              phone_number_id: effectivePhoneNumberId,
              error: reg.error,
              status: reg.status,
            });
          }
        }
        try {
          const { releaseAutoAppEchoPausesForBusiness } = await import("@/lib/wa-app-echo-pause");
          const released = await releaseAutoAppEchoPausesForBusiness({
            admin,
            businessSlug,
          });
          console.info("[embedded-signup] coexistence: released auto app-echo pauses", {
            slug: businessSlug,
            ...released,
          });
        } catch (e) {
          console.error("[embedded-signup] coexistence: auto-pause release failed:", e);
        }
      }
    }
  }

  // `code` reserved for a later server exchange with Meta; not persisted here.
  void code;

  return NextResponse.json({
    success: true,
    phone_display: effectivePhoneDisplay,
    webhook: {
      subscribed: webhookSubscribed,
      ...(webhookError ? { error: webhookError } : {}),
    },
  });
}
