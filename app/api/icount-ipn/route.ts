import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { decryptPaymentSessionSecret } from "@/lib/payment-session-crypto";

export const runtime = "nodejs";

function normalizeEmail(input: unknown): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  // Handle markdown mailto pattern: [a@b.com](mailto:a@b.com)
  const m = raw.match(/\bmailto:([^\s)]+)\b/i);
  const candidate = m?.[1] ? m[1] : raw;
  // If wrapped in [] take inside, otherwise keep.
  const bracket = candidate.match(/^\[([^\]]+)\]$/);
  const unwrapped = bracket?.[1] ? bracket[1] : candidate;
  const email = unwrapped.trim().toLowerCase();
  // Basic sanity: must contain @ and a dot after it.
  if (!email.includes("@")) return "";
  return email;
}

function toSlugBase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildUniqueSlugFromEmail(email: string) {
  const local = (email.split("@")[0] ?? "").trim().toLowerCase();
  const base = toSlugBase(local) || "business";
  const last4 = String(Date.now()).slice(-4);
  return `${base}-${last4}`;
}

async function ensureUniqueSlug(admin: ReturnType<typeof createSupabaseAdminClient>, base: string) {
  const cleanBase = base || "business";
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? cleanBase : `${cleanBase}-${i + 1}`;
    const { data } = await admin.from("businesses").select("id").eq("slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${cleanBase}-${Date.now().toString(36)}`;
}

async function ensurePrimaryBusinessUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  businessId: number,
  userId: string
) {
  const { error } = await admin.from("business_users").upsert(
    {
      business_id: businessId,
      user_id: userId,
      role: "admin",
      status: "active",
      is_primary: true,
    },
    { onConflict: "business_id,user_id" } as any
  );
  if (error) throw error;
}

async function parseIcountPayload(req: NextRequest): Promise<Record<string, any>> {
  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const json = await req.json();
      return typeof json === "object" && json ? (json as any) : {};
    }
  } catch {}

  try {
    const raw = await req.text();
    const params = new URLSearchParams(raw);
    const out: Record<string, any> = {};
    for (const [k, v] of params.entries()) out[k] = v;
    if (Object.keys(out).length) return out;
  } catch {}

  return {};
}

export async function POST(req: NextRequest) {
  // iCount חייב לקבל 200 תמיד כדי לא לעשות retries אינסופיים
  try {
    const expected = process.env.ICOUNT_IPN_SECRET?.trim() || "";
    if (process.env.NODE_ENV === "production" && expected) {
      const qsSecret = req.nextUrl.searchParams.get("secret") ?? "";
      const headerSecret = req.headers.get("x-icount-secret") ?? "";
      const provided = (qsSecret || headerSecret).trim();
      if (!provided || provided !== expected) {
        console.warn("[api/icount-ipn] unauthorized ipn request (missing/invalid secret)");
        return NextResponse.json({ ok: true });
      }
    }

    const payload = await parseIcountPayload(req);

    const emailRaw =
      (typeof payload.email === "string" && payload.email) ||
      (typeof payload.Email === "string" && payload.Email) ||
      (typeof payload.customer_email === "string" && payload.customer_email) ||
      "";
    const customRaw =
      (typeof payload.custom === "string" && payload.custom) ||
      (typeof payload.Custom === "string" && payload.Custom) ||
      (typeof payload.plan === "string" && payload.plan) ||
      "";

    const email = normalizeEmail(emailRaw);
    const custom = String(customRaw).trim().toLowerCase();

    if (!email) return NextResponse.json({ ok: true });

    // Minimal observability: verify plan marker arrives from iCount
    if (custom && custom !== "starter" && custom !== "pro") {
      console.warn("[api/icount-ipn] unexpected_custom:", { email, custom });
    } else if (!custom) {
      console.warn("[api/icount-ipn] missing_custom:", { email });
    }

    const admin = createSupabaseAdminClient();

    const { data: sessionRow } = await admin
      .from("payment_sessions")
      .select(
        "email,plan,first_name,last_name,phone,studio_name,business_type,description,address,password_ciphertext"
      )
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    console.info("[api/icount-ipn] inbound:", {
      email,
      custom,
      has_session: Boolean(sessionRow),
      session_plan: sessionRow?.plan ?? null,
    });

    // מניעת כפילויות: אם משתמש כבר קיים — לא מנסים createUser.
    // IMPORTANT: we must still mark payment_sessions.ready so /onboarding/success can proceed.
    try {
      const { data: existingAuth } = await admin
        .schema("auth")
        .from("users")
        .select("id,email")
        .eq("email", email)
        .maybeSingle();
      if (existingAuth?.id) {
        const paidPlan = (String(custom || sessionRow?.plan || "").trim().toLowerCase() === "pro")
          ? "premium"
          : "basic";
        // Reactivation flow: mark existing business as active + update plan tier.
        const { data: biz } = await admin
          .from("businesses")
          .select("id, slug")
          .eq("user_id", existingAuth.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (biz?.id) {
          await admin
            .from("businesses")
            .update({ is_active: true, plan: paidPlan } as any)
            .eq("id", biz.id);

          // Mark ready for /onboarding/success
          try {
            await admin.from("payment_sessions").insert({ email, slug: biz.slug, ready: true } as any);
          } catch (e) {
            console.error("[api/icount-ipn] payment_sessions ready insert failed (existing biz):", e);
          }

          // Trigger async WhatsApp provisioning *after successful payment* (reactivation flow):
          // enqueue a job only if there's no active channel yet.
          try {
            const { data: existingChannel } = await admin
              .from("whatsapp_channels")
              .select("id, provisioning_status, is_active")
              .eq("business_slug", String(biz.slug).trim().toLowerCase())
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            const hasActive = Boolean((existingChannel as any)?.is_active) || (existingChannel as any)?.provisioning_status === "active";
            if (!hasActive) {
              await admin.from("wa_provision_jobs").insert({
                business_id: biz.id,
                business_slug: String(biz.slug).trim().toLowerCase(),
                business_name: String((sessionRow as any)?.studio_name ?? "").trim() || String(biz.slug),
                status: "queued",
              } as any);
            }
          } catch (e) {
            console.error("[api/icount-ipn] enqueue wa_provision_jobs (reactivation) failed:", e);
          }

          console.info("[api/icount-ipn] reactivated:", {
            email,
            user_id: existingAuth.id,
            business_id: biz.id,
            slug: biz.slug,
            plan: paidPlan,
          });
        } else {
          // User exists but business missing - create it now (paid), then mark ready.
          const baseSlug =
            toSlugBase(String(sessionRow?.studio_name ?? "").trim()) || buildUniqueSlugFromEmail(email);
          const slug = await ensureUniqueSlug(admin, baseSlug);
          const plan =
            (String(sessionRow?.plan ?? "").trim().toLowerCase() || custom) === "pro" ? "premium" : "basic";

          console.info("[api/icount-ipn] existing_user_creating_business:", { email, slug, plan });

          const { data: insertedBiz, error: bizError } = await admin
            .from("businesses")
            .insert({
              user_id: existingAuth.id,
              slug,
              name: (String(sessionRow?.studio_name ?? "").trim() || (email.split("@")[0] ?? "HeyZoe")).trim(),
              niche: String(sessionRow?.business_type ?? "").trim(),
              bot_name: "זואי",
              social_links: {
                address: String(sessionRow?.address ?? "").trim(),
                business_description: String(sessionRow?.description ?? "").trim(),
              },
              plan,
              is_active: true,
              email,
              status: "active",
            } as any)
            .select("id, slug")
            .single();
          if (bizError || !insertedBiz) throw bizError ?? new Error("business_create_failed_existing_user");

          await ensurePrimaryBusinessUser(admin, Number(insertedBiz.id), existingAuth.id);

          try {
            await admin.from("payment_sessions").insert({ email, slug: insertedBiz.slug, ready: true } as any);
          } catch (e) {
            console.error("[api/icount-ipn] payment_sessions ready insert failed (created biz):", e);
          }

          try {
            await admin.from("wa_provision_jobs").insert({
              business_id: insertedBiz.id,
              business_slug: String(insertedBiz.slug).trim().toLowerCase(),
              business_name: (String(sessionRow?.studio_name ?? "").trim() || (email.split("@")[0] ?? "HeyZoe")).trim(),
              status: "queued",
            } as any);
          } catch (e) {
            console.error("[api/icount-ipn] enqueue wa_provision_jobs failed (created biz):", e);
          }
        }
        return NextResponse.json({ ok: true });
      }
    } catch {
      // אם query ל-auth.users נכשל, נמשיך בזהירות
    }

    const passwordCipher = String(sessionRow?.password_ciphertext ?? "").trim();
    const password = passwordCipher ? decryptPaymentSessionSecret(passwordCipher) : "";
    const hasLetter = /[a-zA-Zא-ת]/.test(password);
    const hasDigit = /\d/.test(password);
    if (!password || password.length < 8 || !hasLetter || !hasDigit) {
      console.warn("[api/icount-ipn] missing password session for email:", email);
      return NextResponse.json({ ok: true });
    }

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      phone: sessionRow?.phone ? String(sessionRow.phone).trim() || undefined : undefined,
      user_metadata: {
        first_name: sessionRow?.first_name ? String(sessionRow.first_name).trim() : "",
        last_name: sessionRow?.last_name ? String(sessionRow.last_name).trim() : "",
      },
    });
    if (authError || !authData.user) throw authError ?? new Error("user_create_failed");

    const baseSlug = toSlugBase(String(sessionRow?.studio_name ?? "").trim()) || buildUniqueSlugFromEmail(email);
    const slug = await ensureUniqueSlug(admin, baseSlug);

    const plan =
      (String(sessionRow?.plan ?? "").trim().toLowerCase() || custom) === "pro" ? "premium" : "basic";

    console.info("[api/icount-ipn] creating_business:", { email, slug, plan });

    const { data: insertedBiz, error: bizError } = await admin
      .from("businesses")
      .insert({
        user_id: authData.user.id,
        slug,
        name: (String(sessionRow?.studio_name ?? "").trim() || (email.split("@")[0] ?? "HeyZoe")).trim(),
        niche: String(sessionRow?.business_type ?? "").trim(),
        bot_name: "זואי",
        social_links: {
          address: String(sessionRow?.address ?? "").trim(),
          business_description: String(sessionRow?.description ?? "").trim(),
        },
        plan,
        is_active: true,
        email,
        status: "active",
      } as any)
      .select("id, slug")
      .single();

    if (bizError || !insertedBiz) throw bizError ?? new Error("business_create_failed");

    await ensurePrimaryBusinessUser(admin, Number(insertedBiz.id), authData.user.id);

    await admin
      .from("payment_sessions")
      .insert({ email, slug: insertedBiz.slug, ready: true } as any);

    // Trigger async WhatsApp provisioning *only after payment success* (this webhook).
    // We enqueue a job and let /api/cron/wa-provision process it.
    try {
      await admin.from("wa_provision_jobs").insert({
        business_id: insertedBiz.id,
        business_slug: String(insertedBiz.slug).trim().toLowerCase(),
        business_name: (String(sessionRow?.studio_name ?? "").trim() || (email.split("@")[0] ?? "HeyZoe")).trim(),
        status: "queued",
      } as any);
    } catch (e) {
      console.error("[api/icount-ipn] enqueue wa_provision_jobs failed:", e);
    }

    console.info("[api/icount-ipn] ready:", {
      email,
      slug: insertedBiz.slug,
      business_id: insertedBiz.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/icount-ipn] error:", error);
    return NextResponse.json({ ok: true });
  }
}

