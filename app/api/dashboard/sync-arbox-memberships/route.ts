import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  arboxFetchBoxCategories,
  arboxFetchSchedule,
  formatBoxCategoriesForPrompt,
  formatScheduleItemsForPrompt,
} from "@/lib/arbox-public-api";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
} from "@/lib/dashboard-business-access";

export const runtime = "nodejs";

/**
 * סנכרון Arbox לדשבורד: לוח שיעורים + קטגוריות בלבד (לפרומפט זואי).
 * מנויים וכרטיסיות לא נמשכים מ־API — נשארים כפי שמוגדרים ב־social_links.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as { slug?: string; arbox_api_key?: string };
  const slug = normDashboardSlug(body.slug ?? "");
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id);
  const biz = pickBusinessBySlug(accessible, slug);
  if (!biz) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const socialRaw = biz.social_links;
  const social =
    socialRaw && typeof socialRaw === "object" && !Array.isArray(socialRaw)
      ? ({ ...(socialRaw as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  const bodyKey = String(body.arbox_api_key ?? "").trim();
  const apiKey = bodyKey || String(social.arbox_api_key ?? "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "missing_api_key", message: "חסר מפתח API ארבוקס." },
      { status: 400 }
    );
  }

  const [sch, cat] = await Promise.all([
    arboxFetchSchedule(apiKey, { useCache: false, daysAhead: 14 }),
    arboxFetchBoxCategories(apiKey, { useCache: false }),
  ]);

  const scheduleText = sch.ok
    ? formatScheduleItemsForPrompt(sch.items)
    : `לא נמשך לוח שיעורים מארבוקס: ${sch.message}`;
  const categoriesText = cat.ok
    ? formatBoxCategoriesForPrompt(cat.items)
    : `לא נמשכו קטגוריות שיעור מארבוקס: ${cat.message}`;

  const syncedAt = new Date().toISOString();

  const mergedSocial: Record<string, unknown> = {
    ...social,
    arbox_schedule_prompt_text: scheduleText,
    arbox_box_categories_prompt_text: categoriesText,
    arbox_public_sync_at: syncedAt,
  };

  const { error: updErr } = await admin
    .from("businesses")
    .update({ social_links: mergedSocial as never })
    .eq("slug", slug);

  if (updErr) {
    console.error("[sync-arbox] social_links update failed:", updErr);
    return NextResponse.json(
      { error: "persist_failed", message: updErr.message || "שמירת נתוני ארבוקס נכשלה." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    schedule_synced: sch.ok,
    categories_synced: cat.ok,
    schedule_warning: sch.ok ? undefined : sch.message,
    categories_warning: cat.ok ? undefined : cat.message,
    arbox_public_sync_at: syncedAt,
  });
}
