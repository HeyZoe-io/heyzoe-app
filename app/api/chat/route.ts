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

    const fullPrompt = `את זואי (Zoe), נציגת שירות דיגיטלית עבור: ${businessContext}.

סגנון: עברית בלבד. תשובות קצרות, מקצועיות וידידותיות — בלי חפירות ובלי פתיחים ארוכים.

הודעת המשתמש: ${JSON.stringify(message)}

הנחיות:
- אל תכללי רשימות ארוכות, שאלות המשך או כפתורים בטקסט (הממשק מציג אותם).
- בלי מרקדאון (לא ** ולא #).
- אם מתאים, סיימי במשפט הנעה קצר אחד בלבד (שורה אחת).
- אל תכללי JSON או מפרידי מטא-נתונים בטקסט — השרת מוסיף אותם אחרי הסטרים.`;

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
        } else {
          const cta_text =
            business && typeof business.cta_text === 'string' ? business.cta_text.trim() || null : null;
          const cta_link =
            business && typeof business.cta_link === 'string' ? business.cta_link.trim() || null : null;
          controller.enqueue(
            encoder.encode(
              `${CHAT_STREAM_META}${JSON.stringify({ cta_text, cta_link })}`
            )
          );
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