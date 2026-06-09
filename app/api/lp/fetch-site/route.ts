import { NextRequest, NextResponse } from "next/server";
import { scanWebsiteFromUrl } from "@/lib/fetch-site-scan";

export const runtime = "nodejs";

/** דף נחיתה — סריקת אתר ציבורית (ללא auth). עלות: קריאת Claude לכל סריקה. */
export async function POST(req: NextRequest) {
  let body: { website_url?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = await scanWebsiteFromUrl(String(body.website_url ?? ""));
  return NextResponse.json(result.body, { status: result.status });
}
