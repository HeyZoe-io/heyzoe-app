import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveGeminiApiKey } from "@/lib/server-env";
import { GEMINI_CHAT_MODELS, GEMINI_MODEL_INIT_OPTIONS, normalizeModelName } from "@/lib/gemini";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) return NextResponse.json({ error: "missing_gemini_key" }, { status: 500 });

  const bytes = await file.arrayBuffer();
  const b64 = Buffer.from(bytes).toString("base64");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel(
    { model: normalizeModelName(GEMINI_CHAT_MODELS[0]) },
    GEMINI_MODEL_INIT_OPTIONS
  );

  const prompt =
    "Extract opening hours from the uploaded schedule image/file. Return Hebrew plain text in this exact order:\n" +
    "יום שני: ...\nיום שלישי: ...\nיום רביעי: ...\nיום חמישי: ...\nיום שישי: ...\nשבת: ...\nראשון: ...";

  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType: file.type || "image/png",
        data: b64,
      },
    },
  ]);

  const text = result.response.text().trim();
  return NextResponse.json({ schedule_text: text });
}
