import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveGeminiApiKey } from "@/lib/server-env";
import { GEMINI_MODEL_INIT_OPTIONS, normalizeModelName } from "@/lib/gemini";

export const runtime = "nodejs";

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findLogoCandidate(html: string, pageUrl: string): string {
  const base = new URL(pageUrl);
  const iconMatch =
    html.match(/<link[^>]+rel=["'][^"']*(icon|shortcut icon|apple-touch-icon)[^"']*["'][^>]*>/i)?.[0] ?? "";
  const href = iconMatch.match(/href=["']([^"']+)["']/i)?.[1]?.trim() ?? "";
  if (href) {
    try {
      return new URL(href, base.origin).toString();
    } catch {
      return `${base.origin}/favicon.ico`;
    }
  }
  return `${base.origin}/favicon.ico`;
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { website_url, business_name, niche } = await req.json();
  const url = String(website_url ?? "").trim();
  if (!url) return NextResponse.json({ error: "missing_website_url" }, { status: 400 });

  let pageText = "";
  let logoCandidate = "";
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return NextResponse.json({ error: `website_fetch_failed_${res.status}` }, { status: 400 });
    const html = await res.text();
    logoCandidate = findLogoCandidate(html, url);
    pageText = stripHtmlToText(html).slice(0, 12000);
  } catch {
    return NextResponse.json({ error: "website_fetch_failed" }, { status: 400 });
  }

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) return NextResponse.json({ error: "missing_gemini_key" }, { status: 500 });

  const genAI = new GoogleGenerativeAI(apiKey);
  const websiteModels = ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.5-flash-latest"] as const;

  const prompt = `נתח את טקסט האתר הבא של העסק "${business_name ?? ""}" בתחום "${niche ?? ""}".
החזר JSON בלבד במבנה:
{
  "niche": "נישה קצרה ומדויקת",
  "business_description": "תיאור קצר ומדויק בעברית",
  "logo_url": "URL ללוגו או favicon אם קיים",
  "schedule_text": "שעות בפורמט: יום שני: ... \\nיום שלישי: ... (או ריק)",
  "age_range": "18-25 או 25-40 או 40-60 או 60+ או ריק",
  "gender": "זכר או נקבה או הכול",
  "products": [
    {
      "name": "שם שירות",
      "description": "תיאור קצר",
      "price_text": "מחיר אם נמצא",
      "location_text": "מיקום אם נמצא",
      "benefits": ["עד 4 תגיות מה משיגים מהשירות"],
      "benefit_suggestions": ["3-5 בועות הצעה רלוונטיות"]
    }
  ]
}

טקסט אתר:
${pageText}`;

  let text = "";
  let lastError: unknown = null;
  for (const modelName of websiteModels) {
    try {
      const model = genAI.getGenerativeModel(
        { model: normalizeModelName(modelName) },
        GEMINI_MODEL_INIT_OPTIONS
      );
      const result = await model.generateContent(prompt, { timeout: 40000 });
      text = result.response.text().trim();
      if (text) break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!text) {
    return NextResponse.json({ error: "ai_generation_failed", details: String(lastError ?? "") }, { status: 502 });
  }
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return NextResponse.json({
      niche: typeof parsed.niche === "string" ? parsed.niche : "",
      business_description:
        typeof parsed.business_description === "string" ? parsed.business_description : "",
      logo_url:
        typeof parsed.logo_url === "string" && parsed.logo_url.trim()
          ? parsed.logo_url.trim()
          : logoCandidate,
      schedule_text: typeof parsed.schedule_text === "string" ? parsed.schedule_text : "",
      age_range: typeof parsed.age_range === "string" ? parsed.age_range : "",
      gender:
        parsed.gender === "זכר" || parsed.gender === "נקבה" || parsed.gender === "הכול"
          ? parsed.gender
          : "הכול",
      products: Array.isArray(parsed.products) ? parsed.products.slice(0, 8) : [],
    });
  } catch {
    return NextResponse.json({ error: "ai_parse_failed" }, { status: 502 });
  }
}
