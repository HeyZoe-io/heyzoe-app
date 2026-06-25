import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { encryptPaymentSessionSecret } from "@/lib/payment-session-crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const {
      email,
      plan,
      first_name,
      last_name,
      phone,
      password,
      studio_name,
      business_type,
      description,
      address,
      utm_source,
      utm_campaign,
      utm_content,
    } = (await req.json()) as {
      email?: string;
      plan?: "starter" | "pro";
      first_name?: string;
      last_name?: string;
      phone?: string;
      password?: string;
      studio_name?: string;
      business_type?: string;
      description?: string;
      address?: string;
      utm_source?: string | null;
      utm_campaign?: string | null;
      utm_content?: string | null;
    };

    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!cleanEmail) return NextResponse.json({ error: "missing_email" }, { status: 400 });
    const resolvedPlan = plan === "pro" ? "pro" : "starter";

    const pw = String(password ?? "");
    const hasLetter = /[a-zA-Zא-ת]/.test(pw);
    const hasDigit = /\d/.test(pw);
    if (pw.length < 8 || !hasLetter || !hasDigit) {
      return NextResponse.json({ error: "weak_password" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    const cleanUtm = (v: unknown): string | null => {
      const s = String(v ?? "").trim();
      return s ? s : null;
    };

    // Upsert by email (no unique constraint, so we use insert and keep the latest rows)
    const basePayload = {
      email: cleanEmail,
      plan: resolvedPlan,
      first_name: String(first_name ?? "").trim(),
      last_name: String(last_name ?? "").trim(),
      phone: String(phone ?? "").trim(),
      studio_name: String(studio_name ?? "").trim(),
      business_type: String(business_type ?? "").trim(),
      description: String(description ?? "").trim(),
      address: String(address ?? "").trim(),
      password_ciphertext: encryptPaymentSessionSecret(pw),
      ready: false,
    };
    const payloadWithUtm = {
      ...basePayload,
      utm_source: cleanUtm(utm_source),
      utm_campaign: cleanUtm(utm_campaign),
      utm_content: cleanUtm(utm_content),
    };

    let { error } = await admin.from("payment_sessions").insert(payloadWithUtm as any);
    // Resilient: if the UTM columns are not migrated yet, fall back to the base insert
    // so signups are never blocked by a pending migration.
    if (error && /utm_(source|campaign|content)|column/i.test(String(error.message ?? ""))) {
      ({ error } = await admin.from("payment_sessions").insert(basePayload as any));
    }

    if (error) {
      console.error("[api/onboarding/save-session] insert failed:", error.message);
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, plan: resolvedPlan });
  } catch (e) {
    console.error("[api/onboarding/save-session] error:", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

