import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { getCachedBusinessBySlug } from "@/lib/business-cache";
import {
  listMissingBusinessBootstrapKeys,
  resolveGeminiApiKey,
} from "@/lib/server-env";
import {
  GEMINI_BOOTSTRAP_GENERATE_TIMEOUT_MS,
  GEMINI_BOOTSTRAP_MODELS,
  GEMINI_BOOTSTRAP_RETRY_DELAYS_MS,
  GEMINI_MODEL_INIT_OPTIONS,
  generateRawWithModelFallback,
} from "@/lib/gemini";
import { extractErrorCode, logMessage } from "@/lib/analytics";
import { stripMarkdownDecorations } from "@/lib/zoe-shared";
import { TONE_ANALYSIS_AND_VOICE } from "@/lib/zoe-tone";

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

type AiBootstrapPack = { welcome: string; followups: string[]; tone: string | null };

async function runAiBootstrapPack(
  bizName: string,
  serviceName: string,
  address: string,
  trial: string
): Promise<AiBootstrapPack> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    throw new Error("missing_gemini");
  }

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
{"welcome":"משפט ברוכים הבאים אחד בלבד בעברית — קצר מאוד (עד 14 מילים), חם ומקצועי","followups":["שאלה קצרה 1","שאלה קצרה 2","שאלה קצרה 3","שאלה קצרה 4"],"tone":"leisure או wellness או professional"}

ה־followups: ארבע שאלות קצרות וברורות שהלקוח עשוי לשאול, מותאמות לעסק — לא גנריות לחלוטין.`;

  const text = await generateRawWithModelFallback(
    GEMINI_BOOTSTRAP_MODELS,
    async (modelName) => {
      const model = genAI.getGenerativeModel({ model: modelName }, GEMINI_MODEL_INIT_OPTIONS);
      const result = await model.generateContent(prompt, {
        timeout: GEMINI_BOOTSTRAP_GENERATE_TIMEOUT_MS,
      });
      return result.response.text();
    },
    GEMINI_BOOTSTRAP_RETRY_DELAYS_MS
  );

  const parsed = parseModelJson(text);
  if (!parsed) {
    throw new Error("parse_json");
  }

  const w = typeof parsed.welcome === "string" ? stripMarkdownDecorations(parsed.welcome.trim()) : "";
  if (!w) {
    throw new Error("empty_welcome");
  }

  const t = typeof parsed.tone === "string" ? parsed.tone.trim() : "";
  const tone = t || null;

  const f = parsed.followups;
  if (!Array.isArray(f) || f.length < 4) {
    throw new Error("bad_followups");
  }
  const four = f
    .slice(0, 4)
    .map((x) => (typeof x === "string" ? stripMarkdownDecorations(x.trim()) : ""))
    .filter(Boolean);
  if (four.length !== 4) {
    throw new Error("bad_followups");
  }

  return { welcome: w, followups: four, tone };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug")?.trim()?.replace(/\.$/, "");
  const sessionId = searchParams.get("session_id")?.trim() || null;
  if (!slug) {
    return NextResponse.json({ error: "חסר פרמטר slug" }, { status: 400 });
  }

  const missingKeys = listMissingBusinessBootstrapKeys();
  if (missingKeys.length > 0) {
    return NextResponse.json(
      {
        error:
          "חסרים משתני סביבה. ודאו ש-.env.local קיים ב-heyzoe-app/ (או קישור סימבולי משורש HeyZoe), או הגדירו אותם ב-Vercel → Environment Variables.",
        missing: missingKeys,
      },
      { status: 500 }
    );
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

    let welcome: string;
    let followups: string[];
    let tone: string | null;

    try {
      const pack = await runAiBootstrapPack(bizName, serviceName, address, trial);
      welcome = pack.welcome;
      followups = pack.followups;
      tone = pack.tone;
      await logMessage({
        business_slug: slug,
        role: "assistant",
        content: welcome,
        model_used: "bootstrap",
        session_id: sessionId,
      });
    } catch (geminiErr: unknown) {
      const msg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
      console.error("[HeyZoe api/business] Gemini / bootstrap failed:", geminiErr);
      await logMessage({
        business_slug: slug,
        role: "system",
        content: `bootstrap_failed:${msg}`,
        model_used: "bootstrap",
        session_id: sessionId,
        error_code: extractErrorCode(geminiErr),
      });
      if (msg === "missing_gemini") {
        return NextResponse.json(
          { error: "חסר מפתח Gemini בשרת. בדקו את משתני הסביבה." },
          { status: 500 }
        );
      }
      if (msg === "parse_json" || msg === "empty_welcome" || msg === "bad_followups") {
        return NextResponse.json(
          { error: "תשובת ה-AI לא הייתה בתבנית הצפויה. נסו לרענן." },
          { status: 502 }
        );
      }
      return NextResponse.json(
        { error: "לא ניתן לטעון את זואי כרגע. נסו שוב בעוד רגע." },
        { status: 503 }
      );
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
