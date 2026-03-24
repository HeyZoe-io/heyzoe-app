import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { resolveGeminiApiKey } from "@/lib/server-env";
import { GEMINI_CHAT_MODELS, GEMINI_MODEL_INIT_OPTIONS, normalizeModelName } from "@/lib/gemini";
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

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) return NextResponse.json({ error: "missing_gemini_key" }, { status: 500 });

  const { mode, business_name, niche, service_name } = await req.json();
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = normalizeModelName(GEMINI_CHAT_MODELS[0]);
  const model = genAI.getGenerativeModel({ model: modelName }, GEMINI_MODEL_INIT_OPTIONS);

  const prompt =
    mode === "faq"
      ? `Generate 4 concise Hebrew FAQ pairs for business "${business_name}" in niche "${niche}" service "${service_name}". Return JSON array: [{"question":"","answer":""}] only.`
      : `Write one short Hebrew welcome sentence for chatbot of "${business_name}" niche "${niche}".`;

  const result = await model.generateContent(prompt, { timeout: 30000 });
  const text = result.response.text().trim();

  if (mode === "faq") {
    try {
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      return NextResponse.json({ items: Array.isArray(parsed) ? parsed : [] });
    } catch {
      return NextResponse.json({ items: [] });
    }
  }

  return NextResponse.json({ welcome_message: text.replace(/^["'`]|["'`]$/g, "") });
}
