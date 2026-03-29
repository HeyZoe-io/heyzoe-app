import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveClaudeApiKey } from "@/lib/server-env";
import { CLAUDE_CHAT_MODEL } from "@/lib/claude";

export const runtime = "nodejs";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function resolveImageMediaType(fileMimeType: string): ImageMediaType {
  if (fileMimeType === "image/jpeg" || fileMimeType === "image/jpg") return "image/jpeg";
  if (fileMimeType === "image/gif") return "image/gif";
  if (fileMimeType === "image/webp") return "image/webp";
  return "image/png";
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return NextResponse.json({ error: "missing_anthropic_key" }, { status: 500 });

  const bytes = await file.arrayBuffer();
  const b64 = Buffer.from(bytes).toString("base64");
  const mediaType = resolveImageMediaType(file.type);

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: CLAUDE_CHAT_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: b64 },
          },
          {
            type: "text",
            text:
              "Extract opening hours from the uploaded schedule image/file. Return Hebrew plain text in this exact order:\n" +
              "יום שני: ...\nיום שלישי: ...\nיום רביעי: ...\nיום חמישי: ...\nיום שישי: ...\nשבת: ...\nראשון: ...",
          },
        ],
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  return NextResponse.json({ schedule_text: text });
}
