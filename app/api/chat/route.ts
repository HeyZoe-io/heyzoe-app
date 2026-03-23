import { GoogleGenerativeAI } from "@google/generative-ai";
import { type BusinessInfoRow, getCachedBusinessBySlug } from "@/lib/business-cache";
import {
  friendlyGeminiErrorMessage,
  GEMINI_CHAT_MODELS,
  GEMINI_RETRY_DELAYS_MS,
  isGeminiQuotaOrRateLimitError,
  sleep,
} from "@/lib/gemini";
import { CHAT_STREAM_META } from "@/lib/zoe-shared";
import { TONE_ANALYSIS_AND_VOICE } from "@/lib/zoe-tone";

function parseClientBusiness(body: Record<string, unknown>, bizSlug: string): BusinessInfoRow | null {
  const raw = body.business;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.slug !== "string" || b.slug.trim() !== bizSlug) return null;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return null;
  const sn =
    typeof b.service_name === "string" && b.service_name.trim() ? b.service_name.trim() : name;
  const addr = typeof b.address === "string" && b.address.trim() ? b.address.trim() : null;
  const trial = typeof b.trial_class === "string" && b.trial_class.trim() ? b.trial_class.trim() : null;
  const ct = typeof b.cta_text === "string" && b.cta_text.trim() ? b.cta_text.trim() : null;
  const cl = typeof b.cta_link === "string" && b.cta_link.trim() ? b.cta_link.trim() : null;
  return { name, service_name: sn, address: addr, trial_class: trial, cta_text: ct, cta_link: cl };
}

function defaultBusinessRow(): BusinessInfoRow {
  return {
    name: "העסק שלנו",
    service_name: "העסק שלנו",
    address: null,
    trial_class: null,
    cta_text: null,
    cta_link: null,
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!apiKey || !supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: "חסרים מפתחות הגדרה ב-.env.local" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  let ctaTextRaw = "";
  let ctaLinkRaw = "";

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const bizSlug = typeof body?.slug === "string" && body.slug.trim() ? body.slug.trim() : "acrobyjoe";

    if (!message) {
      return new Response(JSON.stringify({ error: "הודעה ריקה" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const clientSnap = parseClientBusiness(body, bizSlug);
    const row: BusinessInfoRow =
      clientSnap ?? (await getCachedBusinessBySlug(bizSlug)) ?? defaultBusinessRow();

    const bizName = row.name?.trim() || "העסק שלנו";
    const serviceName = row.service_name?.trim() || bizName;
    const address = row.address?.trim() || "לא צוינה כתובת";
    const trial_class = row.trial_class?.trim() || "אין כרגע פרטים על שיעור ניסיון";

    ctaTextRaw = row.cta_text?.trim() || "";
    ctaLinkRaw = row.cta_link?.trim() || "";
    if (!ctaTextRaw || !ctaLinkRaw) {
      console.warn(
        "[HeyZoe api/chat] CTA חסר",
        JSON.stringify({ slug: bizSlug, fromClient: clientSnap !== null })
      );
    }

    const fullPrompt = `את זואי (Zoe), נציגת מכירות דיגיטלית של ${bizName}.

${TONE_ANALYSIS_AND_VOICE}

כללי תשובה בצ'אט:
- עברית בלבד. קצר מאוד — משפטים ספורים, בלי חפירות.
- התאימי את הניסוח לאופי שזיהית (פנאי=אנרגטי וקליל; wellness=רגוע ומכיל; מקצועי=חריף ויוקרתי). בלי פתיחים ארוכים או קיטוחים.
- ישירות לעניין: עובדות ותשובה, כמו "הכתובת רוטשילד 122. יש חניה."
- בלי מרקדאון: לא ** לא * לא # — רק טקסט רגיל.
- בסוף כל תשובה הוסיפי משפט הנעה לפעולה אחד, קצר, שקשור לשירות: "${serviceName}".

מידע מהמערכת (רק עובדות מאלה, בלי להמציא):
- שם העסק: ${bizName}
- שם השירות לשימוש ב-CTA הסיומת: ${serviceName}
- כתובת: ${address}
- שיעור ניסיון / פרטים רלוונטיים: ${trial_class}

הודעת הלקוח: ${message}`;

    const encoder = new TextEncoder();
    const genAI = new GoogleGenerativeAI(apiKey);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let completed = false;
          let lastErr: unknown = null;

          outer: for (const modelName of GEMINI_CHAT_MODELS) {
            for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
              try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const streamResult = await model.generateContentStream(fullPrompt);
                for await (const chunk of streamResult.stream) {
                  const t = chunk.text();
                  if (t) controller.enqueue(encoder.encode(t));
                }
                completed = true;
                break outer;
              } catch (e) {
                lastErr = e;
                if (isGeminiQuotaOrRateLimitError(e) && attempt < GEMINI_RETRY_DELAYS_MS.length) {
                  const wait = GEMINI_RETRY_DELAYS_MS[attempt];
                  console.warn(`[api/chat] עומס Google — המתנה ${wait}ms, ניסיון ${attempt + 2} (${modelName})`);
                  await sleep(wait);
                  continue;
                }
                if (isGeminiQuotaOrRateLimitError(e)) {
                  break;
                }
                throw e;
              }
            }
          }

          if (!completed) {
            throw lastErr ?? new Error("Gemini stream failed");
          }

          const meta = JSON.stringify({
            cta_text: ctaTextRaw || null,
            cta_link: ctaLinkRaw || null,
          });
          controller.enqueue(encoder.encode(`${CHAT_STREAM_META}${meta}`));
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("api/chat:", error);
    const userMsg = friendlyGeminiErrorMessage(error);
    const ctaOk = Boolean(ctaTextRaw && ctaLinkRaw);
    return new Response(
      JSON.stringify({
        error: userMsg,
        cta_text: ctaOk ? ctaTextRaw : null,
        cta_link: ctaOk ? ctaLinkRaw : null,
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }
}
