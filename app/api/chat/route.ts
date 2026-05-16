import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_CHAT_MODEL, CLAUDE_MAX_TOKENS, formatUserFacingClaudeError, resolveClaudeApiKey, sleepMs } from '@/lib/claude';
import { extractErrorCode, logMessage } from '@/lib/analytics';
import { getBusinessKnowledgePack, buildSystemPrompt } from '@/lib/business-context';
import { loadZoePlatformGuidelines } from '@/lib/business-zoe-platform';
import { CHAT_STREAM_META } from '@/lib/zoe-shared';

export const runtime = 'nodejs';

const RETRY_DELAYS = [1500, 4000] as const;

export async function POST(req: NextRequest) {
  try {
    const apiKey = resolveClaudeApiKey();
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }), { status: 500 });
    }

    const { message, slug, business, session_id } = await req.json();
    if (!message || !slug) {
      return new Response(JSON.stringify({ error: 'Missing message or slug' }), { status: 400 });
    }

    await logMessage({
      business_slug: String(slug),
      role: 'user',
      content: String(message),
      session_id: typeof session_id === 'string' ? session_id : null,
    });

    const [knowledge, platform] = await Promise.all([
      getBusinessKnowledgePack(String(slug)),
      loadZoePlatformGuidelines(),
    ]);
    const systemPrompt = buildSystemPrompt(knowledge, String(slug), 'web', undefined, platform);

    const client = new Anthropic({ apiKey });
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let assistantTextAcc = "";
        let success = false;
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
          try {
            if (attempt > 0) {
              await sleepMs(RETRY_DELAYS[attempt - 1]);
              console.info(`[Chat API] Claude retry ${attempt}/${RETRY_DELAYS.length}`);
            }
            console.log(`[Chat API] Claude ${CLAUDE_CHAT_MODEL} (attempt ${attempt + 1})`);

            const response = await client.messages.create({
              model: CLAUDE_CHAT_MODEL,
              max_tokens: CLAUDE_MAX_TOKENS,
              stream: true,
              system: systemPrompt,
              messages: [{ role: 'user', content: String(message) }],
            });

            for await (const event of response) {
              if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                const text = event.delta.text;
                if (text) {
                  assistantTextAcc += text;
                  controller.enqueue(encoder.encode(text));
                }
              }
            }

            success = true;
            break;
          } catch (e) {
            lastError = e;
            console.error(`[Chat API] Claude attempt ${attempt + 1} failed:`, e);
            const isRetryable = /429|529|overloaded|rate.?limit|too.?many.?requests/i.test(
              e instanceof Error ? e.message : String(e)
            );
            if (!isRetryable || attempt >= RETRY_DELAYS.length) break;
          }
        }

        if (!success) {
          console.error("[Chat API] All Claude attempts failed:", lastError);
          const errMsg = formatUserFacingClaudeError(lastError);
          await logMessage({
            business_slug: String(slug),
            role: "assistant",
            content: errMsg,
            model_used: CLAUDE_CHAT_MODEL,
            session_id: typeof session_id === "string" ? session_id : null,
            error_code: extractErrorCode(lastError),
          });
          controller.enqueue(encoder.encode(errMsg));
        } else {
          await logMessage({
            business_slug: String(slug),
            role: "assistant",
            content: assistantTextAcc.trim(),
            model_used: CLAUDE_CHAT_MODEL,
            session_id: typeof session_id === "string" ? session_id : null,
          });
          const cta_text =
            knowledge?.ctaText?.trim() ||
            (business && typeof business.cta_text === 'string' ? business.cta_text.trim() : "") ||
            null;
          const cta_link =
            knowledge?.ctaLink?.trim() ||
            (business && typeof business.cta_link === 'string' ? business.cta_link.trim() : "") ||
            null;
          controller.enqueue(encoder.encode(`${CHAT_STREAM_META}${JSON.stringify({ cta_text, cta_link })}`));
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
    const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error('[Chat API Error]:', msg, error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}
