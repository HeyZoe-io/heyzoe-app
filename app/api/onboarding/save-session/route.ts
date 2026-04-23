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

    // Upsert by email (no unique constraint, so we use insert and keep the latest rows)
    const { error } = await admin.from("payment_sessions").insert({
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
    } as any);

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

