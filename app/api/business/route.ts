import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { getCachedBusinessBySlug } from "@/lib/business-cache";
import { GEMINI_BOOTSTRAP_MODELS, generateRawWithModelFallback } from "@/lib/gemini";
import { stripMarkdownDecorations } from "@/lib/zoe-shared";
import { TONE_ANALYSIS_AND_VOICE } from "@/lib/zoe-tone";

const DEFAULT_FOLLOWUPS = ["איפה אתם?", "מה המחיר?", "למי זה מתאים?", "איך נרשמים?"];

function parseModelJson(text: string): Record<string, unknown> | null {
  let raw = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  if (fenced) raw = fenced[1].trim();
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json({ error: "חסר פרמטר slug" }, { status: 400 });
  }

  if (!apiKey || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "חסרים מפתחות הגדרה ב-.env.local" }, { status: 500 });
  }

  try {
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

    let welcome = `שלום, כאן זואי מ־${bizName}. במה אפשר לעזור?`;
    let followups = [...DEFAULT_FOLLOWUPS];
    let tone: string | null = null;

    try {
      const genAI = new GoogleGenerativeAI(apiKey);

      const prompt = `את זואי (Zoe), נציגת המותג של "${bizName}".

${TONE_ANALYSIS_AND_VOICE}

הקשר מהמערכת:
- שם עסק: ${bizName}
- שירות/מוצר: ${serviceName}
${address ? `- כתובת (לשאלות מיקום בלבד, לא לשבח): ${address}` : ""}
${trial ? `- מידע נוסף: ${trial}` : ""}

משימה: החזירי JSON בלבד — בלי טקסט לפני או אחרי, בלי בלוקי קוד markdown.
המבנה המדויק:
{"welcome":"משפט ברוכים הבאים אחד, קצר מאוד (עד 16 מילים) בעברית, שמשקף את הטון המתאים לעסק","followups":["שאלה קצרה 1","שאלה קצרה 2","שאלה קצרה 3","שאלה קצרה 4"],"tone":"leisure או wellness או professional"}

ה־followups: ארבע שאלות קצרות וברורות שהלקוח עשוי לשאול (למשל מיקום, מחיר, התאמה, הרשמה), מותאמות לעסק ולטון — לא גנריות לחלוטין.`;

      const text = await generateRawWithModelFallback(GEMINI_BOOTSTRAP_MODELS, async (modelName) => {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        return result.response;
      });
      const parsed = parseModelJson(text);

      if (parsed) {
        const w = typeof parsed.welcome === "string" ? stripMarkdownDecorations(parsed.welcome.trim()) : "";
        if (w) welcome = w;
        const t = typeof parsed.tone === "string" ? parsed.tone.trim() : "";
        if (t) tone = t;
        const f = parsed.followups;
        if (Array.isArray(f) && f.length >= 4) {
          const four = f
            .slice(0, 4)
            .map((x) => (typeof x === "string" ? stripMarkdownDecorations(x.trim()) : ""))
            .filter(Boolean);
          if (four.length === 4) followups = four;
        }
      }

      welcome = stripMarkdownDecorations(welcome);
    } catch (geminiErr: unknown) {
      console.error("[HeyZoe api/business] Gemini welcome/followups failed, using defaults:", geminiErr);
    }

    return NextResponse.json({
      slug,
      name: bizName,
      service_name: serviceName,
      address: address || "",
      trial_class: trial || "",
      cta_text: ctaTextRaw || null,
      cta_link: ctaLinkRaw || null,
      welcome,
      followups,
      tone,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("GET /api/business:", e);
    return NextResponse.json({ error: "בעיה בטעינת נתוני העסק", details: message }, { status: 500 });
  }
}
