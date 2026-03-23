import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_CHAT_MODELS, GEMINI_RETRY_DELAYS_MS, isRetryableGeminiError, normalizeModelName } from '@/lib/gemini';
import { CHAT_STREAM_META } from '@/lib/zoe-shared';

export const runtime = 'edge';
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing GEMINI_API_KEY' }), { status: 500 });
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const { message, slug, business } = await req.json();

    if (!message || !slug) {
      return new Response(JSON.stringify({ error: 'Missing message or slug' }), { status: 400 });
    }

    const businessContext = business 
      ? `שם העסק: ${business.name}, שירות: ${business.service_name}, כתובת: ${business.address}, שיעור ניסיון: ${business.trial_class}`
      : `Business Slug: ${slug}`;

    const fullPrompt = `
      את זואי, עוזרת בינה מלאכותית ידידותית עבור העסק: ${businessContext}.
      המטרה שלך היא להיות עוזרת, תמציתית ולעודד את המשתמש לפעולה (כמו הרשמה לשיעור ניסיון).
      
      הודעת המשתמש: "${message}"
      
      הוראות תגובה:
      1. עני תמיד בעברית טבעית וחמה.
      2. היי מקצועית אך נגישה.
      3. בסוף התשובה, הוסיפי הנעה לפעולה (CTA) קצרה ו-2-4 שאלות המשך רלוונטיות.
      4. את המטא-דאטה (JSON) הוסיפי רק בסוף אחרי המפריד "${CHAT_STREAM_META}".
    `;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let lastError: unknown = null;
        let success = false;

        for (const modelNameRaw of GEMINI_CHAT_MODELS) {
          const modelName = normalizeModelName(modelNameRaw);
          for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
            try {
              console.log(`[Chat API] Attempting model: ${modelName} (try ${attempt + 1})`);
              const model = genAI.getGenerativeModel({ model: modelName });
              const streamResult = await model.generateContentStream(fullPrompt);

              for await (const chunk of streamResult.stream) {
                const text = chunk.text();
                if (text) {
                  controller.enqueue(encoder.encode(text));
                }
              }
              
              success = true;
              break;
            } catch (e: unknown) {
              console.error(`[Chat API] Failed with ${modelName}:`, e);
              lastError = e;
              const canRetry = isRetryableGeminiError(e) && attempt < GEMINI_RETRY_DELAYS_MS.length;
              if (canRetry) {
                await new Promise((resolve) => setTimeout(resolve, GEMINI_RETRY_DELAYS_MS[attempt]));
                continue;
              }
              break;
            }
          }
          if (success) break;
        }

        if (!success) {
          const errorMsg = lastError instanceof Error ? lastError.message : 'All models failed';
          controller.enqueue(encoder.encode(`מצטערת, יש לי קצת קשיים בחיבור כרגע. אפשר לנסות שוב? (שגיאה: ${errorMsg})`));
        }
        
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error: unknown) {
    console.error('[Chat API Error]:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}