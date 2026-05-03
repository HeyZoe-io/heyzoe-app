import { NextResponse } from "next/server";

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
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to: "972508318162",
    type: "template",
    template: {
      name: "hello_world",
      language: { code: "en_US" },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

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
