import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

function slugify(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const slugRaw = req.nextUrl.searchParams.get("slug") ?? "";
  const currentSlug = req.nextUrl.searchParams.get("current") ?? "";
  const base = slugify(slugRaw);
  if (!base) return NextResponse.json({ slug: "", available: false, message: "סלאג לא תקין" });

  const admin = createSupabaseAdminClient();
  let candidate = base;
  let counter = 1;

  while (true) {
    const { data } = await admin
      .from("businesses")
      .select("slug, user_id")
      .eq("slug", candidate)
      .maybeSingle();

    const free =
      !data || data.slug === currentSlug || (data.user_id && data.user_id === user.id);
    if (free) {
      return NextResponse.json({
        slug: candidate,
        available: candidate === base,
        message:
          candidate === base
            ? "הסלאג זמין"
            : `הסלאג תפוס. הוצע: ${candidate}`,
      });
    }

    candidate = `${base}-${counter}`;
    counter += 1;
    if (counter > 100) {
      return NextResponse.json({ slug: "", available: false, message: "לא נמצא סלאג זמין" });
    }
  }
}
