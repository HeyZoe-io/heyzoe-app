import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRAPH_API_VERSION = "v21.0";
const WABA_ID = "1005359108553743";
const TEMPLATE_NAME = "sanga_welcome2";

/** זמני — read-only בדיקת סטטוס טמפלייט sanga_welcome2 ב-Meta. מחק אחרי הבדיקה. */
export async function GET() {
  if (process.env.ENABLE_SANGA_TEMPLATE_STATUS_CHECK !== "1") {
    return NextResponse.json(
      { error: "Set ENABLE_SANGA_TEMPLATE_STATUS_CHECK=1 to enable this route." },
      { status: 403 }
    );
  }

  const token =
    process.env.META_ACCESS_TOKEN?.trim() ||
    process.env.WHATSAPP_SYSTEM_TOKEN?.trim() ||
    "";

  if (!token) {
    return NextResponse.json(
      { error: "Missing META_ACCESS_TOKEN / WHATSAPP_SYSTEM_TOKEN" },
      { status: 500 }
    );
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(WABA_ID)}/message_templates?name=${encodeURIComponent(TEMPLATE_NAME)}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const raw = (await res.json().catch(() => ({}))) as {
      data?: Array<{ name?: string; status?: string; language?: string }>;
      error?: unknown;
    };

    if (!res.ok) {
      console.error("[debug/sanga-template-status] meta_graph_error:", { status: res.status, body: raw });
      return NextResponse.json({ error: "meta_graph_failed", meta: raw }, { status: 502 });
    }

    const templates = (raw.data ?? []).map((t) => ({
      name: t.name ?? null,
      status: t.status ?? null,
      language: t.language ?? null,
    }));

    return NextResponse.json({ templates });
  } catch (e) {
    console.error("[debug/sanga-template-status] error:", e);
    return NextResponse.json({ error: "meta_graph_failed" }, { status: 502 });
  }
}
