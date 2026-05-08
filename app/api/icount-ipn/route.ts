import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { decryptPaymentSessionSecret } from "@/lib/payment-session-crypto";
import { extractIcountClientIdFromPayload } from "@/lib/icount-v3";
import { sendEmail } from "@/lib/send-email";

export const runtime = "nodejs";

function esc(s: string): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function registerMetaNumberAndEmailAdmin(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_id: number;
  business_slug: string;
  business_name: string;
  customer_email: string;
}) {
  const adminEmail = "liornativ@hotmail.com";
  const token = (process.env.WHATSAPP_SYSTEM_TOKEN ?? "").trim();
  const pin = (process.env.WHATSAPP_REGISTRATION_PIN ?? "123456").trim();

  try {
    const { data: ch, error: chErr } = await input.admin
      .from("whatsapp_channels")
      .select("phone_number_id")
      .eq("business_id", input.business_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const phoneNumberId = String((ch as any)?.phone_number_id ?? "").trim();
    if (chErr || !phoneNumberId) {
      await sendEmail({
        to: adminEmail,
        subject: `❌ שגיאה ברישום WhatsApp — ${input.business_name}`,
        htmlContent: [
          `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
          `<p><b>שם העסק:</b> ${esc(input.business_name)}</p>`,
          `<p><b>Phone Number ID:</b> ${esc(phoneNumberId || "-")}</p>`,
          `<p><b>שגיאה:</b> ${esc(String((chErr as any)?.message ?? "missing_phone_number_id"))}</p>`,
          `</div>`,
        ].join(""),
      });
      return;
    }

    if (!token) {
      await sendEmail({
        to: adminEmail,
        subject: `❌ שגיאה ברישום WhatsApp — ${input.business_name}`,
        htmlContent: [
          `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
          `<p><b>שם העסק:</b> ${esc(input.business_name)}</p>`,
          `<p><b>Phone Number ID:</b> ${esc(phoneNumberId)}</p>`,
          `<p><b>שגיאה:</b> חסר WHATSAPP_SYSTEM_TOKEN</p>`,
          `</div>`,
        ].join(""),
      });
      return;
    }

    const url = `https://graph.facebook.com/v18.0/${encodeURIComponent(phoneNumberId)}/register`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    });

    const text = await res.text().catch(() => "");
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    const ok = res.ok && Boolean(json?.success);
    if (ok) {
      await sendEmail({
        to: adminEmail,
        subject: `✅ לקוח חדש הוקם בהצלחה — ${input.business_name}`,
        htmlContent: [
          `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
          `<p><b>שם העסק:</b> ${esc(input.business_name)}</p>`,
          `<p><b>slug:</b> ${esc(input.business_slug)}</p>`,
          `<p><b>מייל לקוח:</b> ${esc(input.customer_email)}</p>`,
          `<p><b>Phone Number ID:</b> ${esc(phoneNumberId)}</p>`,
          `</div>`,
        ].join(""),
      });
      return;
    }

    const metaErr = json ?? text ?? `http_${res.status}`;
    await sendEmail({
      to: adminEmail,
      subject: `❌ שגיאה ברישום WhatsApp — ${input.business_name}`,
      htmlContent: [
        `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
        `<p><b>שם העסק:</b> ${esc(input.business_name)}</p>`,
        `<p><b>Phone Number ID:</b> ${esc(phoneNumberId)}</p>`,
        `<p><b>תשובת Meta:</b></p>`,
        `<pre style="direction:ltr;white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:10px;border:1px solid #eee">${esc(
          typeof metaErr === "string" ? metaErr : JSON.stringify(metaErr, null, 2)
        )}</pre>`,
        `</div>`,
      ].join(""),
    });
  } catch (e: any) {
    try {
      await sendEmail({
        to: adminEmail,
        subject: `❌ שגיאה ברישום WhatsApp — ${input.business_name}`,
        htmlContent: [
          `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;line-height:1.7">`,
          `<p><b>שם העסק:</b> ${esc(input.business_name)}</p>`,
          `<p><b>שגיאה:</b> ${esc(String(e?.message ?? e))}</p>`,
          `</div>`,
        ].join(""),
      });
    } catch {
      // ignore
    }
  }
}

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

function normalizePhone(input: unknown): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;

  // 05XXXXXXXX -> +9725XXXXXXX (best-effort)
  if (digits.startsWith("05")) {
    const rest = digits.slice(1).replace(/\D/g, "");
    if (rest.length < 9) return null;
    return `+972${rest}`;
  }

  // 972XXXXXXXXX -> +972XXXXXXXXX
  if (digits.startsWith("972")) {
    const rest = digits.replace(/\D/g, "");
    if (rest.length < 11) return null;
    return `+${rest}`;
  }

  // Already E.164
  if (digits.startsWith("+")) {
    const rest = digits.slice(1).replace(/\D/g, "");
    if (rest.length < 10) return null;
    return `+${rest}`;
  }

  return null;
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

function isSchemaColumnMissing(error: any, column: string): boolean {
  const code = String(error?.code ?? "");
  const msg = String(error?.message ?? "");
  return code === "PGRST204" && msg.toLowerCase().includes(`'${column}' column`);
}

async function insertBusinessResilient(admin: ReturnType<typeof createSupabaseAdminClient>, payload: any) {
  // First attempt
  let r = await admin.from("businesses").insert(payload).select("id, slug").single();
  if (!r.error) return r;

  // Retry removing missing columns (limited to known optional ones)
  const optionalCols = ["email", "status", "plan_price", "icount_client_id"];
  let nextPayload = { ...payload };
  for (const col of optionalCols) {
    if (r.error && isSchemaColumnMissing(r.error, col) && col in nextPayload) {
      const { [col]: _omit, ...rest } = nextPayload as any;
      nextPayload = rest;
      r = await admin.from("businesses").insert(nextPayload).select("id, slug").single();
      if (!r.error) return r;
    }
  }
  return r;
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
    const icountClientId = extractIcountClientIdFromPayload(payload as Record<string, unknown>);

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
      icount_client_id: icountClientId ?? null,
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
        const paidPlanPrice = paidPlan === "premium" ? 499 : 349;
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
            .update({
              is_active: true,
              plan: paidPlan,
              plan_price: paidPlanPrice,
              ...(icountClientId ? { icount_client_id: icountClientId } : {}),
            } as any)
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

          // Critical Meta registration step (best-effort; must not fail IPN)
          void registerMetaNumberAndEmailAdmin({
            admin,
            business_id: Number(biz.id),
            business_slug: String(biz.slug).trim().toLowerCase(),
            business_name: String((sessionRow as any)?.studio_name ?? "").trim() || String(biz.slug),
            customer_email: email,
          });

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
          const plan_price = plan === "premium" ? 499 : 349;

          console.info("[api/icount-ipn] existing_user_creating_business:", { email, slug, plan });

          const insertPayloadBase: any = {
            user_id: existingAuth.id,
            slug,
            name: (String(sessionRow?.studio_name ?? "").trim() || (email.split("@")[0] ?? "HeyZoe")).trim(),
            niche: String(sessionRow?.business_type ?? "").trim(),
            bot_name: "זואי",
            social_links: {
              address: String(sessionRow?.address ?? "").trim(),
              tagline: String(sessionRow?.description ?? "").trim(),
              business_description: String(sessionRow?.description ?? "").trim(),
            },
            plan,
            plan_price,
            is_active: true,
            email,
            status: "active",
            ...(icountClientId ? { icount_client_id: icountClientId } : {}),
          };

          const r = await insertBusinessResilient(admin, insertPayloadBase);
          const insertedBiz = r.data as any;
          const bizError = r.error as any;
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

          // Critical Meta registration step (best-effort; must not fail IPN)
          void registerMetaNumberAndEmailAdmin({
            admin,
            business_id: Number(insertedBiz.id),
            business_slug: String(insertedBiz.slug).trim().toLowerCase(),
            business_name: (String(sessionRow?.studio_name ?? "").trim() || (email.split("@")[0] ?? "HeyZoe")).trim(),
            customer_email: email,
          });
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

    const phoneE164 = normalizePhone(sessionRow?.phone);

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      phone: phoneE164 ?? undefined,
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
    const plan_price = plan === "premium" ? 499 : 349;

    console.info("[api/icount-ipn] creating_business:", { email, slug, plan });

    const insertPayloadBase: any = {
      user_id: authData.user.id,
      slug,
      name: (String(sessionRow?.studio_name ?? "").trim() || (email.split("@")[0] ?? "HeyZoe")).trim(),
      niche: String(sessionRow?.business_type ?? "").trim(),
      bot_name: "זואי",
      social_links: {
        address: String(sessionRow?.address ?? "").trim(),
        tagline: String(sessionRow?.description ?? "").trim(),
        business_description: String(sessionRow?.description ?? "").trim(),
      },
      plan,
      plan_price,
      is_active: true,
      email,
      status: "active",
      ...(icountClientId ? { icount_client_id: icountClientId } : {}),
    };

    const r = await insertBusinessResilient(admin, insertPayloadBase);
    const insertedBiz = r.data as any;
    const bizError = r.error as any;

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

    // Critical Meta registration step (best-effort; must not fail IPN)
    void registerMetaNumberAndEmailAdmin({
      admin,
      business_id: Number(insertedBiz.id),
      business_slug: String(insertedBiz.slug).trim().toLowerCase(),
      business_name: (String(sessionRow?.studio_name ?? "").trim() || (email.split("@")[0] ?? "HeyZoe")).trim(),
      customer_email: email,
    });

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

