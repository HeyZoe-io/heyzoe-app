import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { resolveClaudeApiKey } from "@/lib/server-env";
import { CLAUDE_CHAT_MODEL } from "@/lib/claude";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return NextResponse.json({ error: "missing_anthropic_key" }, { status: 500 });

  const {
    mode,
    business_name,
    niche,
    service_name,
    service_description,
    website_url,
    business_description,
    target_audience,
    benefits,
    vibe,
    schedule_text,
  } = await req.json();

  const prompt =
    mode === "faq"
      ? `צור בדיוק 3 זוגות שאלה-תשובה בעברית עבור השירות "${service_name}" של העסק "${business_name}".
הקשר שירות: "${service_description ?? ""}".
החזר JSON בלבד במבנה: [{"question":"","answer":""}]`
      : mode === "goals"
      ? `על בסיס הנישה "${niche}" והשירות "${service_name}", הצע 3 צ'יפים קצרים בעברית ל"באים בשביל...".
החזר JSON בלבד במבנה: {"goals":["...","...","..."]}`
      : mode === "tags"
      ? `על בסיס העסק "${business_name}" בנישה "${niche}", החזר JSON בלבד במבנה:
{"target_audience":["...","...","..."],"benefits":["...","...","..."],"vibe":["חברי","מקצועי","מצחיק"]}
החזר בדיוק 3 ערכים לכל שדה.`
      : `כתוב הודעת פתיחה מקצועית וקצרה בעברית לצ'אטבוט של "${business_name}" בתחום "${niche}".
אתר: "${website_url ?? ""}".
תיאור עסק: "${business_description ?? ""}".
קהל יעד: ${(target_audience ?? []).join(", ")}.
יתרונות: ${(benefits ?? []).join(", ")}.
סגנון דיבור: ${(vibe ?? []).join(", ")}.
שעות פעילות: "${schedule_text ?? ""}".
אם חסר מידע השתמשי במה שיש והישארי עניינית.
אסור להשתמש בניסוח "איך אפשר לעזור".
החזר משפט אחד בלבד עם שם הבוט ונימה מותאמת לסגנון הדיבור.`;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: CLAUDE_CHAT_MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";

  if (mode === "faq") {
    try {
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      return NextResponse.json({ items: Array.isArray(parsed) ? parsed.slice(0, 3) : [] });
    } catch {
      return NextResponse.json({ items: [] });
    }
  }

  if (mode === "tags") {
    try {
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      return NextResponse.json({
        target_audience: Array.isArray(parsed.target_audience) ? parsed.target_audience.slice(0, 3) : [],
        benefits: Array.isArray(parsed.benefits) ? parsed.benefits.slice(0, 3) : [],
        vibe: Array.isArray(parsed.vibe) ? parsed.vibe.slice(0, 3) : [],
      });
    } catch {
      return NextResponse.json({ target_audience: [], benefits: [], vibe: [] });
    }
  }

  if (mode === "goals") {
    try {
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      return NextResponse.json({
        goals: Array.isArray(parsed.goals) ? parsed.goals.slice(0, 3) : [],
      });
    } catch {
      return NextResponse.json({ goals: [] });
    }
  }

  return NextResponse.json({ welcome_message: text.replace(/^["'`]|["'`]$/g, "") });
}
