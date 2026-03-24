import { NextResponse } from "next/server";
import { getCachedBusinessBySlug } from "@/lib/business-cache";
import { getPublicBusinessBySlug } from "@/lib/business-settings";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug")?.trim()?.replace(/\.$/, "");
  if (!slug) {
    return NextResponse.json({ error: "חסר פרמטר slug" }, { status: 400 });
  }

  try {
    const configured = await getPublicBusinessBySlug(slug);
    if (configured) {
      return NextResponse.json({
        slug,
        name: configured.name || "העסק שלנו",
        service_name: configured.service_name,
        address: configured.address || "",
        trial_class: configured.trial_class || "",
        cta_text: configured.cta_text || null,
        cta_link: configured.cta_link || null,
        welcome: configured.welcome_message,
        followups: ["מה המחיר?", "איפה אתם נמצאים?", "איך נרשמים?", "למי זה מתאים?"],
        tone: null,
        bot_name: configured.bot_name,
        primary_color: configured.primary_color,
        secondary_color: configured.secondary_color,
      });
    }

    const business = await getCachedBusinessBySlug(slug);

    const bizName = (business?.name as string | undefined)?.trim() || "העסק שלנו";
    const serviceName = (business?.service_name as string | undefined)?.trim() || bizName;
    const ctaTextRaw = typeof business?.cta_text === "string" ? business.cta_text.trim() : "";
    const ctaLinkRaw = typeof business?.cta_link === "string" ? business.cta_link.trim() : "";
    if (!ctaTextRaw || !ctaLinkRaw) {
      console.warn(
        "[HeyZoe api/business] CTA לא מוצג — חסר cta_text או cta_link ב-Supabase",
        JSON.stringify({ slug, cta_text: business?.cta_text ?? null, cta_link: business?.cta_link ?? null })
      );
    }
    const address = (business?.address as string | undefined)?.trim() || "";
    const trial = (business?.trial_class as string | undefined)?.trim() || "";

    return NextResponse.json({
      slug,
      name: bizName,
      service_name: serviceName,
      address: address || "",
      trial_class: trial || "",
      cta_text: ctaTextRaw || null,
      cta_link: ctaLinkRaw || null,
      welcome: `שלום, כאן זואי מ-${bizName}. איך אפשר לעזור?`,
      followups: ["מה המחיר?", "איפה אתם נמצאים?", "איך נרשמים?", "למי זה מתאים?"],
      tone: null,
      bot_name: "זואי",
      primary_color: "#ff85cf",
      secondary_color: "#bc74e9",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("GET /api/business:", e);
    return NextResponse.json({ error: "בעיה בטעינת נתוני העסק", details: message }, { status: 500 });
  }
}
