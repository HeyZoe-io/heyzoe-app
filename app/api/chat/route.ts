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
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
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

type KnowledgePack = {
  businessName: string;
  niche: string;
  servicesText: string;
  faqsText: string;
  ctaText: string;
  ctaLink: string;
  targetAudienceText: string;
  benefitsText: string;
  vibeText: string;
  ageRangeText: string;
  genderText: string;
  scheduleText: string;
};

function truncateText(value: string, max = 280): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}...`;
}

function clampPromptSize(prompt: string, maxChars = 7000): string {
  if (prompt.length <= maxChars) return prompt;
  return `${prompt.slice(0, maxChars)}\n\n[המשך הידע קוצר אוטומטית לשמירה על יציבות המודל]`;
}

async function getBusinessKnowledgePack(slug: string): Promise<KnowledgePack | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data: business } = await admin
      .from("businesses")
      .select("id, name, niche, cta_text, cta_link, social_links")
      .eq("slug", slug)
      .maybeSingle();
    if (!business) return null;

    const [{ data: services }, { data: faqs }] = await Promise.all([
      admin
        .from("services")
        .select("name, description, price_text, location_text")
        .eq("business_id", business.id)
        .order("created_at", { ascending: true }),
      admin
        .from("faqs")
        .select("question, answer")
        .eq("business_id", business.id)
        .order("sort_order", { ascending: true }),
    ]);

    const servicesText =
      services?.length
        ? services
            .slice(0, 6)
            .map(
              (s, i) =>
                `${i + 1}. ${truncateText(String(s.name ?? ""), 60)} | מחיר: ${truncateText(
                  String(s.price_text ?? "לא צוין"),
                  40
                )} | מיקום: ${
                  s.location_text ?? "לא צוין"
                } | תיאור: ${truncateText(String(s.description ?? ""), 140)}`
            )
            .join("\n")
        : "אין שירותים מוגדרים.";

    const faqsText =
      faqs?.length
        ? faqs
            .slice(0, 8)
            .map((f, i) => `${i + 1}. ש: ${truncateText(String(f.question ?? ""), 110)} | ת: ${truncateText(String(f.answer ?? ""), 150)}`)
            .join("\n")
        : "אין FAQ מוגדר.";

    const social =
      business.social_links && typeof business.social_links === "object"
        ? (business.social_links as Record<string, unknown>)
        : {};

    return {
      businessName: String(business.name ?? slug),
      niche: String(business.niche ?? ""),
      servicesText,
      faqsText,
      ctaText: String(business.cta_text ?? ""),
      ctaLink: String(business.cta_link ?? ""),
      targetAudienceText: Array.isArray(social.target_audience)
        ? social.target_audience.join(", ")
        : "",
      benefitsText: Array.isArray(social.benefits) ? social.benefits.join(", ") : "",
      vibeText: Array.isArray(social.vibe) ? social.vibe.join(", ") : "",
      ageRangeText: typeof social.age_range === "string" ? social.age_range : "",
      genderText:
        social.gender === "זכר" || social.gender === "נקבה" || social.gender === "הכול"
          ? social.gender
          : "",
      scheduleText: typeof social.schedule_text === "string" ? social.schedule_text : "",
    };
  } catch (e) {
    console.warn("[Chat API] business knowledge pack fetch failed:", e);
    return null;
  }
}

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

    const knowledge = await getBusinessKnowledgePack(String(slug));

    const businessContext = business
      ? `שם העסק: ${business.name}, שירות: ${business.service_name}, כתובת: ${business.address}, שיעור ניסיון: ${business.trial_class}`
      : `Business Slug: ${slug}`;

    const pathInstructions = buildPathAwareInstructions(pathname);

    const rawPrompt = `את זואי, נציגת השירות של העסק.
שם העסק: ${knowledge?.businessName || business?.name || slug}
סגנון דיבור (Vibe): ${knowledge?.vibeText || "חם, מקצועי וקצר"}
לוגו העסק: ${(business && typeof business.logo_url === "string" && business.logo_url) || "לא הוגדר"}
הקשר: ${businessContext}. ${pathInstructions}

כללים:
- עברית בלבד.
- תשובה קצרה: 1-2 משפטים, אלא אם ביקשו פירוט.
- בלי Markdown, בלי JSON.
- אם נשאל על הרשמה/תשלום: לכלול CTA אם קיים.

ידע עסקי:
נישה: ${truncateText(knowledge?.niche ?? "", 90)}
שירותים:
${knowledge?.servicesText ?? "לא הוגדר"}
FAQ:
${knowledge?.faqsText ?? "לא הוגדר"}
CTA: ${truncateText(knowledge?.ctaText || "לא הוגדר", 90)} | ${truncateText(knowledge?.ctaLink || "לא הוגדר", 120)}
קהל יעד: ${truncateText(knowledge?.targetAudienceText || "לא הוגדר", 90)} | גיל: ${knowledge?.ageRangeText || "לא הוגדר"} | מגדר: ${knowledge?.genderText || "לא הוגדר"}
יתרונות: ${truncateText(knowledge?.benefitsText || "לא הוגדר", 120)}
שעות פעילות: ${truncateText(knowledge?.scheduleText || "לא הוגדר", 220)}

הודעת המשתמש:
${String(message)}`;
    const fullPrompt = clampPromptSize(rawPrompt, 7000);

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
            (knowledge?.ctaText?.trim() || "") ||
            (business && typeof business.cta_text === 'string' ? business.cta_text.trim() : "") ||
            null;
          const cta_link =
            (knowledge?.ctaLink?.trim() || "") ||
            (business && typeof business.cta_link === 'string' ? business.cta_link.trim() : "") ||
            null;
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