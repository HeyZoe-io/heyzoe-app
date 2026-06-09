import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { scanWebsiteFromUrl } from "@/lib/fetch-site-scan";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { website_url, business_name, niche } = await req.json();
  const result = await scanWebsiteFromUrl(String(website_url ?? ""), {
    business_name,
    niche,
  });
  return NextResponse.json(result.body, { status: result.status });
}
