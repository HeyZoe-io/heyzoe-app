import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveMetaAppSecret } from "@/lib/whatsapp";

export const runtime = "nodejs";

const PRIVACY_URL = "https://heyzoe.io/privacy";

/** Base64url → Buffer (adds padding for Node). */
function base64UrlToBuffer(segment: string): Buffer {
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64");
}

/**
 * Verifies Meta / Facebook signed_request (HMAC-SHA256 over the payload segment).
 * @see https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
function parseSignedRequest(
  signedRequest: string,
  appSecret: string
): { user_id: string } | null {
  const trimmed = signedRequest.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return null;
  const encodedSig = trimmed.slice(0, dot);
  const payload = trimmed.slice(dot + 1);
  if (!encodedSig || !payload || !appSecret) return null;

  try {
    const expectedSig = createHmac("sha256", appSecret).update(payload).digest();
    const sig = base64UrlToBuffer(encodedSig);
    if (sig.length !== expectedSig.length || !timingSafeEqual(sig, expectedSig)) {
      return null;
    }
    const json = base64UrlToBuffer(payload).toString("utf8");
    const data = JSON.parse(json) as { user_id?: unknown };
    const userId = typeof data.user_id === "string" ? data.user_id.trim() : "";
    if (!userId) return null;
    return { user_id: userId };
  } catch {
    return null;
  }
}

/**
 * Exact-match variants for `contacts.phone` (and exact Meta user_id if stored as-is).
 */
function contactPhoneVariantsFromMetaUserId(userId: string): string[] {
  const raw = userId.trim();
  if (!raw) return [];
  const out = new Set<string>();
  out.add(raw);

  const stripped = raw.replace(/^whatsapp:/i, "").trim();
  if (stripped) out.add(stripped);

  const digits = stripped.replace(/\D/g, "");
  if (digits.length >= 8) {
    out.add(digits);
    out.add(`+${digits}`);
  }

  return [...out];
}

/**
 * WhatsApp webhook session ids look like `wa_<phone_number_id>_+<country...>`.
 * Match on suffix `_%_+E164` so we do not substring-match the business phone_number_id digits.
 */
function messageSessionLikePatterns(userId: string): string[] {
  const stripped = userId.replace(/^whatsapp:/i, "").trim();
  const digits = stripped.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return [];
  return [`%_+${digits}`];
}

async function extractSignedRequest(req: NextRequest): Promise<string | null> {
  const raw = await req.text();
  if (!raw.trim()) return null;

  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    return params.get("signed_request");
  }
  if (ct.includes("application/json")) {
    try {
      const body = JSON.parse(raw) as { signed_request?: unknown };
      return typeof body.signed_request === "string" ? body.signed_request : null;
    } catch {
      return null;
    }
  }

  // Fallback: try form, then JSON
  const form = new URLSearchParams(raw);
  const fromForm = form.get("signed_request");
  if (fromForm) return fromForm;
  try {
    const body = JSON.parse(raw) as { signed_request?: unknown };
    return typeof body.signed_request === "string" ? body.signed_request : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const appSecret = resolveMetaAppSecret();
  if (!appSecret) {
    console.error("[api/data-deletion] missing WHATSAPP_APP_SECRET / META_APP_SECRET");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 503 });
  }

  let signedRequest: string | null;
  try {
    signedRequest = await extractSignedRequest(req);
  } catch (e) {
    console.error("[api/data-deletion] read body failed:", e);
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!signedRequest) {
    return NextResponse.json({ error: "missing signed_request" }, { status: 400 });
  }

  const parsed = parseSignedRequest(signedRequest, appSecret);
  if (!parsed) {
    console.warn("[api/data-deletion] invalid signed_request signature or payload");
    return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  }

  const contactVariants = contactPhoneVariantsFromMetaUserId(parsed.user_id);
  const messagePatterns = messageSessionLikePatterns(parsed.user_id);
  const confirmation_code = randomUUID();

  try {
    const admin = createSupabaseAdminClient();

    if (contactVariants.length > 0) {
      const { error: contactsErr } = await admin.from("contacts").delete().in("phone", contactVariants);
      if (contactsErr) {
        console.error("[api/data-deletion] contacts delete:", contactsErr.message);
        return NextResponse.json({ error: "deletion_failed" }, { status: 500 });
      }
    }

    for (const pattern of messagePatterns) {
      const { error: msgErr } = await admin.from("messages").delete().ilike("session_id", pattern);
      if (msgErr) {
        console.error("[api/data-deletion] messages delete:", msgErr.message);
        return NextResponse.json({ error: "deletion_failed" }, { status: 500 });
      }
    }

    console.info("[api/data-deletion] processed", {
      confirmation_code,
      contact_variants: contactVariants.length,
      message_patterns: messagePatterns.length,
    });

    return NextResponse.json({
      url: PRIVACY_URL,
      confirmation_code,
    });
  } catch (e) {
    console.error("[api/data-deletion] failed:", e);
    return NextResponse.json({ error: "deletion_failed" }, { status: 500 });
  }
}
