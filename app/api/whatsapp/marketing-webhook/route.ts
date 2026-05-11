import { NextRequest, NextResponse } from "next/server";
import {
  explainMetaWebhookSkip,
  resolveMetaAppSecret,
  resolveMetaVerifyToken,
  verifyMetaSignature256,
} from "@/lib/whatsapp";
import { processMarketingMetaInbound } from "@/lib/marketing-webhook-inbound";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode") ?? "";
  const token = sp.get("hub.verify_token") ?? "";
  const challenge = sp.get("hub.challenge") ?? "";
  const expected = resolveMetaVerifyToken();
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Unauthorized", { status: 401 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const rawStripped = rawBody.replace(/^\uFEFF/, "");
  const trimmed = rawStripped.trim();
  if (!trimmed.startsWith("{")) {
    return NextResponse.json({ ok: true, ignored: "non_json" });
  }
  let metaPayload: Record<string, unknown>;
  try {
    metaPayload = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true, ignored: "bad_json" });
  }
  if (metaPayload.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true, ignored: "not_waba" });
  }

  const appSecret = resolveMetaAppSecret();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (appSecret) {
    if (!verifyMetaSignature256(appSecret, sig, rawBody)) {
      console.warn("[marketing-webhook] invalid Meta signature");
      return new Response("Unauthorized", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return new Response("Service Unavailable", { status: 503 });
  }

  try {
    await processMarketingMetaInbound(metaPayload);
  } catch (e) {
    console.error("[marketing-webhook] handler error:", e);
    return NextResponse.json({ ok: false, error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
