import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function normalizePhoneE164(input: unknown): string | null {
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const phoneParam = (searchParams.get("phone") || "").trim();
  if (!phoneParam) return NextResponse.json({ exists: false });

  const phone = normalizePhoneE164(phoneParam);
  // Important: do not block onboarding on invalid phone formats.
  if (!phone) return NextResponse.json({ exists: false });

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .schema("auth")
      .from("users")
      .select("id")
      .eq("phone", phone)
      .limit(1);

    if (error) {
      console.error("[api/onboarding/check-phone] error:", error);
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({ exists: Boolean(data && data.length > 0) });
  } catch (e) {
    console.error("[api/onboarding/check-phone] error:", e);
    return NextResponse.json({ exists: false });
  }
}

