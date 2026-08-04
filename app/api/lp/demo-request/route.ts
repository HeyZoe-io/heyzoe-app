import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/send-email";

export const runtime = "nodejs";

const LEAD_TO = "liornativ@hotmail.com";

const DAYS = new Set(["ראשון", "שני", "שלישי", "רביעי", "חמישי"]);
const SLOTS = new Set(["10-12", "14-16", "16-18"]);

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 120;
}

function isValidPhone(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

/**
 * דף נחיתה — בקשת שיחה. עלות: מייל Brevo אחד לשליחה מוצלחת.
 * Scheduling: none (on-demand).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return withCors(NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }));
    }

    // Honeypot — bots fill this; humans leave empty
    const hp = String(body.company_website ?? "").trim();
    if (hp) {
      return withCors(NextResponse.json({ ok: true }));
    }

    const fullName = String(body.full_name ?? "").trim().slice(0, 80);
    const phone = String(body.phone ?? "").trim().slice(0, 30);
    const email = String(body.email ?? "").trim().slice(0, 120).toLowerCase();
    const businessName = String(body.business_name ?? "").trim().slice(0, 120);
    const day = String(body.preferred_day ?? "").trim();
    const slot = String(body.preferred_slot ?? "").trim();

    if (!fullName) {
      return withCors(NextResponse.json({ ok: false, error: "missing_full_name" }, { status: 400 }));
    }
    if (!isValidPhone(phone)) {
      return withCors(NextResponse.json({ ok: false, error: "invalid_phone" }, { status: 400 }));
    }
    if (!isValidEmail(email)) {
      return withCors(NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 }));
    }
    if (!businessName) {
      return withCors(NextResponse.json({ ok: false, error: "missing_business_name" }, { status: 400 }));
    }
    if (!DAYS.has(day)) {
      return withCors(NextResponse.json({ ok: false, error: "invalid_day" }, { status: 400 }));
    }
    if (!SLOTS.has(slot)) {
      return withCors(NextResponse.json({ ok: false, error: "invalid_slot" }, { status: 400 }));
    }

    const slotLabel =
      slot === "10-12" ? "10:00–12:00" : slot === "14-16" ? "14:00–16:00" : "16:00–18:00";

    const subject = `ליד מדף נחיתה — ${businessName} (${fullName})`;
    const htmlContent = `
      <div style="font-family:Heebo,Arial,sans-serif;direction:rtl;text-align:right;line-height:1.7;color:#1a0a3c;">
        <h2 style="margin:0 0 12px;color:#7133da;">בקשת שיחה מדף הנחיתה</h2>
        <p style="margin:0 0 8px;"><strong>שם מלא:</strong> ${escapeHtml(fullName)}</p>
        <p style="margin:0 0 8px;"><strong>טלפון:</strong> ${escapeHtml(phone)}</p>
        <p style="margin:0 0 8px;"><strong>מייל:</strong> ${escapeHtml(email)}</p>
        <p style="margin:0 0 8px;"><strong>שם העסק:</strong> ${escapeHtml(businessName)}</p>
        <p style="margin:0 0 8px;"><strong>יום מועדף:</strong> ${escapeHtml(day)}</p>
        <p style="margin:0 0 8px;"><strong>שעה מועדפת:</strong> ${escapeHtml(slotLabel)}</p>
      </div>
    `.trim();

    const result = await sendEmail({ to: LEAD_TO, subject, htmlContent });
    if (!result.ok) {
      console.error("[api/lp/demo-request] email failed:", result.error);
      return withCors(
        NextResponse.json({ ok: false, error: "email_failed", detail: result.error }, { status: 502 })
      );
    }

    return withCors(NextResponse.json({ ok: true }));
  } catch (e) {
    console.error("[api/lp/demo-request] failed:", e);
    return withCors(NextResponse.json({ ok: false, error: "request_failed" }, { status: 500 }));
  }
}
