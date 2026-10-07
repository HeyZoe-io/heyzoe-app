import { NextResponse } from "next/server";
import { isNonProdSendBlocked, postWhatsAppGraphMessage } from "@/lib/notifications/graph-whatsapp-send";

export const runtime = "nodejs";

/** זמני — מופעל רק עם ENABLE_META_HELLO_TEST=1 ב-.env (מחק אחרי הבדיקה) */
export async function GET() {
  if (process.env.ENABLE_META_HELLO_TEST !== "1") {
    return NextResponse.json({ error: "Set ENABLE_META_HELLO_TEST=1 to enable this route." }, { status: 403 });
  }

  const token =
    process.env.WHATSAPP_TOKEN?.trim() ||
    process.env.META_ACCESS_TOKEN?.trim() ||
    process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ||
    "";

  if (!token) {
    return NextResponse.json(
      { error: "Missing WHATSAPP_TOKEN / META_ACCESS_TOKEN / WHATSAPP_SYSTEM_TOKEN" },
      { status: 500 }
    );
  }

  const phoneNumberId = "1032443923294518";
  const to = "972508318162";
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: "hello_world",
      language: { code: "en_US" },
    },
  };

  let res: Response;
  try {
    res = await postWhatsAppGraphMessage({ phoneNumberId, to, token, body });
  } catch (error) {
    if (isNonProdSendBlocked(error)) {
      return NextResponse.json({ error: "non_prod_send_blocked" }, { status: 403 });
    }
    throw error;
  }

  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }

  console.log("[meta-whatsapp-hello] HTTP", res.status, res.statusText);
  console.log("[meta-whatsapp-hello] body:", typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));

  return NextResponse.json(
    { httpStatus: res.status, meta: parsed },
    { status: res.ok ? 200 : 502 }
  );
}
