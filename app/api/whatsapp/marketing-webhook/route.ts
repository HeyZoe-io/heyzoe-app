import { NextRequest, NextResponse } from "next/server";
import {
  resolveMetaAppSecret,
  resolveMetaVerifyToken,
  verifyMetaSignature256,
  parseMetaWebhook,
  sendMetaWhatsAppMessage,
} from "@/lib/whatsapp";
import { handleMarketingFlowInbound, callMarketingAI } from "@/lib/marketing-flow-runtime";

export const runtime = "nodejs";

const MARKETING_META_PHONE_NUMBER_ID = "1179786855208358";

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

  const msg = parseMetaWebhook(metaPayload);
  if (!msg || msg.type !== "text") {
    console.info("[marketing-webhook] ignored (no text message)");
    return NextResponse.json({ ok: true });
  }

  const phone = msg.from;
  const userText = msg.text;
  console.info("[marketing-webhook] inbound from:", phone, "text:", userText.slice(0, 80));

  try {
    const { handled } = await handleMarketingFlowInbound(phone, userText);

    if (handled) {
      console.info("[marketing-webhook] flow handled for:", phone);
      return NextResponse.json({ ok: true });
    }

    console.info("[marketing-webhook] flow done, routing to AI for:", phone);
    const reply = await callMarketingAI(userText);
    await sendMetaWhatsAppMessage(MARKETING_META_PHONE_NUMBER_ID, phone, { type: "text", text: reply });
    console.info("[marketing-webhook] AI reply sent to:", phone);
  } catch (e) {
    console.error("[marketing-webhook] error:", e);
    try {
      await sendMetaWhatsAppMessage(MARKETING_META_PHONE_NUMBER_ID, phone, {
        type: "text",
        text: "משהו השתבש אצלנו, ננסה שוב בקרוב 🙏",
      });
    } catch { /* best effort */ }
  }

  return NextResponse.json({ ok: true });
}
