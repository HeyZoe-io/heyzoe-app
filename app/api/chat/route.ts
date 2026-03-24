import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  GEMINI_CHAT_COOLDOWN_BETWEEN_MODELS_MS,
  GEMINI_CHAT_MODELS,
  GEMINI_CHAT_QUOTA_RETRY_DELAYS_MS,
  GEMINI_MODEL_INIT_OPTIONS,
  GEMINI_RETRY_DELAYS_MS,
  formatUserFacingGeminiError,
  isImmediateModelSwitchError,
  isQuotaOrRateLimitError,
  isRetryableGeminiError,
  normalizeModelName,
  sleepMs,
} from '@/lib/gemini';
import { extractErrorCode, logMessage } from '@/lib/analytics';
import { resolveGeminiApiKey } from '@/lib/server-env';
import { CHAT_STREAM_META } from '@/lib/zoe-shared';

/** הוראות נוספות לפי נתיב הדף — דף הבית נשאר כללי */
function buildPathAwareInstructions(pathname: unknown): string {
  if (pathname == null || typeof pathname !== 'string') return '';
  const p = pathname.trim().toLowerCase();
  if (p === '' || p === '/') return '';

  if (p.includes('acrobyjoe')) {
    return `

הקשר מה-URL (חובה ליישם בתשובותיך בעברית):
You are now representing 'Acrobyjoe' studio. Your answers should focus on their specific services, prices, and location (Studio for Acrobalance and movement). Do not answer as a generic business — ground every reply in this studio.`;
  }

  return '';
}

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  try {
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Missing GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY)' }),
        { status: 500 }
      );
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    const { message, slug, business, pathname, session_id } = await req.json();

    if (!message || !slug) {
      return new Response(JSON.stringify({ error: 'Missing message or slug' }), { status: 400 });
    }

    await logMessage({
      business_slug: String(slug),
      role: 'user',
      content: String(message),
      session_id: typeof session_id === 'string' ? session_id : null,
    });

    const businessContext = business 
      ? `שם העסק: ${business.name}, שירות: ${business.service_name}, כתובת: ${business.address}, שיעור ניסיון: ${business.trial_class}`
      : `Business Slug: ${slug}`;

    const pathInstructions = buildPathAwareInstructions(pathname);

    const fullPrompt = `את זואי (Zoe), נציגת שירות דיגיטלית עבור: ${businessContext}.${pathInstructions}

כללים חובה:
- עברית בלבד. אסור אנגלית או שפות אחרות.
- קצרה בטירוף: לכל היותר משפט אחד או שניים, אלא אם המשתמש ביקש במפורש פירוט נרחב יותר.
- טון: חמים ומקצועיים — ישירים, בלי סרק או פתיחים ארוכים.

הודעת המשתמש: ${JSON.stringify(message)}

הנחיות נוספות:
- בלי רשימות ארוכות, בלי שאלות המשך ובלי "כפתורים" בטקסט (הממשק מציג המשך).
- בלי מרקדאון (לא ** ולא #).
- אל תכללי JSON או מפרידי מטא-נתונים — השרת מוסיף אותם אחרי הסטרים.`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let lastError: unknown = null;
        let success = false;
        let usedModel: string | null = null;
        let assistantTextAcc = "";

        for (const modelNameRaw of GEMINI_CHAT_MODELS) {
          const modelName = normalizeModelName(modelNameRaw);
          let leftModelFor404 = false;
          for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
            try {
              console.log(`[Chat API] Attempting model: ${modelName} (try ${attempt + 1})`);
              const model = genAI.getGenerativeModel({ model: modelName }, GEMINI_MODEL_INIT_OPTIONS);
              console.log("Using model:", modelName);
              const streamResult = await model.generateContentStream(fullPrompt);

              for await (const chunk of streamResult.stream) {
                const text = chunk.text();
                if (text) {
                  assistantTextAcc += text;
                  controller.enqueue(encoder.encode(text));
                }
              }
              
              success = true;
              usedModel = modelName;
              break;
            } catch (e: unknown) {
              console.error(`[Chat API] Failed with ${modelName}:`, e);
              lastError = e;
              if (isImmediateModelSwitchError(e)) {
                leftModelFor404 = true;
                console.warn(`[Chat API] Model unavailable, trying next (no retry backoff): ${modelName}`);
                break;
              }
              const canRetry = isRetryableGeminiError(e) && attempt < GEMINI_RETRY_DELAYS_MS.length;
              if (canRetry) {
                const delays = isQuotaOrRateLimitError(e)
                  ? GEMINI_CHAT_QUOTA_RETRY_DELAYS_MS
                  : GEMINI_RETRY_DELAYS_MS;
                console.log(
                  `[Chat API] Retry after ${delays[attempt]}ms (${isQuotaOrRateLimitError(e) ? "quota/RPM" : "transient"})`
                );
                await sleepMs(delays[attempt]);
                continue;
              }
              break;
            }
          }
          if (success) break;
          if (!leftModelFor404 && lastError && isRetryableGeminiError(lastError)) {
            console.log(
              `[Chat API] Cooldown ${GEMINI_CHAT_COOLDOWN_BETWEEN_MODELS_MS}ms before next model`
            );
            await sleepMs(GEMINI_CHAT_COOLDOWN_BETWEEN_MODELS_MS);
          }
        }

        if (!success) {
          const errCode = extractErrorCode(lastError);
          await logMessage({
            business_slug: String(slug),
            role: "assistant",
            content: formatUserFacingGeminiError(lastError),
            model_used: usedModel,
            session_id: typeof session_id === "string" ? session_id : null,
            error_code: errCode,
          });
          controller.enqueue(encoder.encode(formatUserFacingGeminiError(lastError)));
        } else {
          await logMessage({
            business_slug: String(slug),
            role: "assistant",
            content: assistantTextAcc.trim(),
            model_used: usedModel,
            session_id: typeof session_id === "string" ? session_id : null,
          });
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