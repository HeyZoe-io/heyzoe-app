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

function normalizeComparablePhone(input: unknown): string | null {
  const e164 = normalizePhoneE164(input);
  if (e164) return e164;
  // Fallback: keep digits only (for odd formats) but don't "invent" a number.
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const onlyDigits = raw.replace(/[^\d]/g, "");
  if (onlyDigits.length < 9) return null;
  return onlyDigits;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const phoneParam = (searchParams.get("phone") || "").trim();
  if (!phoneParam) return NextResponse.json({ exists: false });

  const phone = normalizeComparablePhone(phoneParam);
  // Important: do not block onboarding on invalid phone formats.
  if (!phone) return NextResponse.json({ exists: false });

  try {
    const admin = createSupabaseAdminClient();
    // We cannot query auth.users via PostgREST in some Supabase projects because the `auth`
    // schema is not exposed. Use the Admin Auth API instead (paginated).
    const perPage = 1000;
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage } as any);
      if (error) {
        console.error("[api/onboarding/check-phone] listUsers error:", error);
        return NextResponse.json({ exists: false });
      }
      const users = (data?.users ?? []) as Array<{ phone?: string | null }>;
      if (users.length === 0) break;

      const found = users.some((u) => {
        const uPhone = normalizeComparablePhone(u.phone ?? "");
        if (!uPhone) return false;
        // Compare both normalized E.164 and digits-only when needed.
        if (uPhone === phone) return true;
        const a = String(uPhone).replace(/[^\d]/g, "");
        const b = String(phone).replace(/[^\d]/g, "");
        return a && b && a === b;
      });
      if (found) return NextResponse.json({ exists: true });

      if (users.length < perPage) break;
    }

    return NextResponse.json({ exists: false });
  } catch (e) {
    console.error("[api/onboarding/check-phone] error:", e);
    return NextResponse.json({ exists: false });
  }
}

