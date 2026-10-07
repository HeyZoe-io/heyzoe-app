import { NextResponse } from "next/server";
import { getCachedBusinessBySlug } from "@/lib/business-cache";
import { buildConfiguredPublicBusinessResponse } from "@/lib/public-business-response";
import { getPublicBusinessBySlug } from "@/lib/business-settings";

/**
 * נתוני עסק מ-Supabase בלבד — מהיר, בלי קריאה ל-Gemini.
 * משמש לפתיחת ממשק הצ'אט מיד, לפני שמגיעה הברכה מה-AI.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json({ error: "חסר פרמטר slug" }, { status: 400 });
  }

  try {
    const configured = await getPublicBusinessBySlug(slug);
    if (configured) {
      return NextResponse.json(
        buildConfiguredPublicBusinessResponse(configured, { variant: "quick", requestSlug: slug }),
        {
          headers: {
            "Cache-Control": "private, max-age=45, stale-while-revalidate=120",
          },
        }
      );
    }

    const business = await getCachedBusinessBySlug(slug);
    if (!business) {
      return NextResponse.json({ error: "עסק לא נמצא" }, { status: 404 });
    }

    const name = (business.name as string | undefined)?.trim() || "";
    const serviceName = (business.service_name as string | undefined)?.trim() || name || "העסק שלנו";
    const ctaTextRaw = typeof business.cta_text === "string" ? business.cta_text.trim() : "";
    const ctaLinkRaw = typeof business.cta_link === "string" ? business.cta_link.trim() : "";
    const address = (business.address as string | undefined)?.trim() || "";
    const trial = (business.trial_class as string | undefined)?.trim() || "";

    return NextResponse.json(
      {
        slug,
        name: name || "העסק שלנו",
        logo_url: null,
        service_name: serviceName,
        address,
        trial_class: trial,
        cta_text: ctaTextRaw || null,
        cta_link: ctaLinkRaw || null,
      },
      {
        headers: {
          "Cache-Control": "private, max-age=45, stale-while-revalidate=120",
        },
      }
    );
  } catch (e: unknown) {
    console.error("GET /api/business/quick:", e);
    return NextResponse.json({ error: "בעיה בטעינת נתוני העסק" }, { status: 500 });
  }
}
