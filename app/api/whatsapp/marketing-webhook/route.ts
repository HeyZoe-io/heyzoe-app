import { NextRequest, NextResponse } from "next/server";
import {
  resolveMetaAppSecret,
  resolveMetaVerifyToken,
  verifyMetaSignature256,
  parseMetaWebhook,
  sendMetaWhatsAppMessage,
} from "@/lib/whatsapp";
import { handleMarketingFlowInbound } from "@/lib/marketing-flow-runtime";
import {
  CLAUDE_WHATSAPP_MODEL,
  CLAUDE_WHATSAPP_MAX_TOKENS,
  resolveClaudeApiKey,
  formatUserFacingClaudeError,
  isRetryableClaudeError,
  sleepMs,
} from "@/lib/claude";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const MARKETING_META_PHONE_NUMBER_ID = "1179786855208358";

const MARKETING_SYSTEM_PROMPT = `את זואי — עוזרת AI חכמה של HeyZoe.
HeyZoe היא פלטפורמה שמאפשרת לבעלי עסקים (סטודיו, מאמנים, מטפלים) לחבר עוזרת AI בוואטסאפ שעונה ללידים שלהם 24/7, מטפלת בשאלות חוזרות, ומקדמת אותם להרשמה.

כשמישהו שולח הודעה:
- ענו בעברית, בטון חם, קצר וידידותי
- אם שואלים על HeyZoe — הסבירו בקצרה מה זה ואיך זה עוזר
- אם שואלים שאלה טכנית — כוונו אותם לצוות שלנו
- אם זו סתם שיחה — היו נחמדות ומזמינות
- אל תמציאו מחירים או תכונות שלא הוזכרו
- שמרו על הודעות קצרות (2-3 משפטים מקס)`;

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

async function callMarketingAI(userText: string): Promise<string> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return "אין לי אפשרות לענות כרגע, נחזור אליך בהקדם!";

  const client = new Anthropic({ apiKey });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: CLAUDE_WHATSAPP_MODEL,
        max_tokens: CLAUDE_WHATSAPP_MAX_TOKENS,
        system: MARKETING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userText }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock?.text?.trim() || "תודה על ההודעה! נחזור אליך בהקדם.";
    } catch (e) {
      if (attempt === 0 && isRetryableClaudeError(e)) {
        await sleepMs(1500);
        continue;
      }
      console.error("[marketing-webhook] Claude error:", e);
      return formatUserFacingClaudeError(e);
    }
  }

  return "תודה על ההודעה! נחזור אליך בהקדם.";
}
