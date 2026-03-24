import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveGeminiApiKey } from "@/lib/server-env";
import { GEMINI_CHAT_MODELS, GEMINI_MODEL_INIT_OPTIONS, normalizeModelName } from "@/lib/gemini";

export const runtime = "nodejs";

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return NextResponse.json({ error: `website_fetch_failed_${res.status}` }, { status: 400 });
    const html = await res.text();
    pageText = stripHtmlToText(html).slice(0, 12000);
  } catch {
    return NextResponse.json({ error: "website_fetch_failed" }, { status: 400 });
  }

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) return NextResponse.json({ error: "missing_gemini_key" }, { status: 500 });

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel(
    { model: normalizeModelName(GEMINI_CHAT_MODELS[0]) },
    GEMINI_MODEL_INIT_OPTIONS
  );

  const prompt = `נתח את טקסט האתר הבא של העסק "${business_name ?? ""}" בתחום "${niche ?? ""}".
החזר JSON בלבד במבנה:
{
  "business_description": "תיאור קצר ומדויק בעברית",
  "age_range": "18-25 או 25-40 או 40-60 או 60+ או ריק",
  "gender": "זכר או נקבה או הכול",
  "benefits": ["3 תגיות על מה משיגים מהשירות"]
}

טקסט אתר:
${pageText}`;

  const result = await model.generateContent(prompt, { timeout: 35000 });
  const text = result.response.text().trim();
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return NextResponse.json({
      business_description:
        typeof parsed.business_description === "string" ? parsed.business_description : "",
      age_range: typeof parsed.age_range === "string" ? parsed.age_range : "",
      gender:
        parsed.gender === "זכר" || parsed.gender === "נקבה" || parsed.gender === "הכול"
          ? parsed.gender
          : "הכול",
      benefits: Array.isArray(parsed.benefits) ? parsed.benefits.slice(0, 3) : [],
    });
  } catch {
    return NextResponse.json({ error: "ai_parse_failed" }, { status: 502 });
  }
}
