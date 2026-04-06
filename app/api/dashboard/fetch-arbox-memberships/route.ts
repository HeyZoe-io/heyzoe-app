import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveClaudeApiKey } from "@/lib/server-env";
import {
  CLAUDE_FETCH_SITE_MODEL,
  CLAUDE_FETCH_SITE_MAX_TOKENS,
  CLAUDE_FETCH_SITE_FALLBACK_MAX_TOKENS,
} from "@/lib/claude";

export const runtime = "nodejs";

const PAGE_TEXT_MAX_CHARS = 14_000;
const FETCH_TIMEOUT_MS = 14_000;

async function fetchWithTimeout(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&ndash;": "-",
    "&mdash;": "-",
  };
  return input
    .replace(/&(nbsp|amp|quot|#39|lt|gt|ndash|mdash);/g, (m) => named[m] ?? m)
    .replace(/&#(\d+);/g, (_, num) => {
      const n = Number(num);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    });
}

function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function stripJsonTrailingCommas(s: string): string {
  return s.replace(/,(\s*[}\]])/g, "$1");
}

function extractBalancedJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function extractFencedJson(text: string): string | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const inner = m?.[1]?.trim();
  return inner && inner.startsWith("{") ? inner : null;
}

function tryParseJsonFromAi(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/[\u201c\u201d\u201e]/g, '"');

  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const candidates: string[] = [];
  const fenced = extractFencedJson(cleaned);
  if (fenced) candidates.push(fenced);

  const noOuterFence = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const balanced = extractBalancedJsonObject(noOuterFence);
  if (balanced) candidates.push(balanced);
  candidates.push(noOuterFence);
  const start = noOuterFence.indexOf("{");
  const end = noOuterFence.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = noOuterFence.slice(start, end + 1);
    if (!candidates.includes(slice)) candidates.push(slice);
  }

  for (const raw of candidates) {
    const repaired = stripJsonTrailingCommas(raw);
    const p = tryParse(repaired);
    if (p) return p;
  }
  return null;
}

/** מיזוג כל בלוקי הטקסט מתשובת Claude (לפעמים מפוצלים לכמה בלוקים) */
function mergeClaudeTextContent(
  content: ReadonlyArray<{ type: string; text?: string }>
): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

function normalizeArboxKeys(parsed: Record<string, unknown>): Record<string, unknown> {
  const tiers =
    parsed.membership_tiers ??
    parsed.membershipTiers ??
    parsed.memberships ??
    parsed.plans;
  const cards =
    parsed.punch_cards ?? parsed.punchCards ?? parsed.passes ?? parsed.packages;
  return {
    membership_tiers: Array.isArray(tiers) ? tiers : [],
    punch_cards: Array.isArray(cards) ? cards : [],
  };
}

function isArboxHost(hostname: string): boolean {
  return /arboxapp\.com$/i.test(hostname) || hostname.includes("arbox");
}

async function fetchJinaReader(pageUrl: string): Promise<string> {
  /** חובה encode — אחרת ה־& ב־query של ארבוקס נחתך ונהיה query של r.jina.ai */
  const jina = `https://r.jina.ai/${encodeURIComponent(pageUrl)}`;
  try {
    const jRes = await fetchWithTimeout(jina, { headers: BROWSER_HEADERS });
    if (!jRes.ok) return "";
    const jBody = await jRes.text();
    return decodeHtmlEntities(stripHtmlToText(jBody));
  } catch {
    return "";
  }
}

async function loadPageText(url: string): Promise<string> {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* ignore */
  }

  let res = await fetchWithTimeout(url, { redirect: "follow", headers: BROWSER_HEADERS });
  let html = res.ok ? await res.text() : "";
  let text = decodeHtmlEntities(stripHtmlToText(html));

  /** דפי Arbox הם כמעט תמיד SPA — Jina מחזירה מרקדאון עם מחירים אמיתיים */
  if (isArboxHost(host)) {
    const jinaText = await fetchJinaReader(url);
    if (jinaText.length >= 400) text = jinaText;
    else if (jinaText.length > text.length) text = jinaText;
  } else if (text.length < 700) {
    const jinaText = await fetchJinaReader(url);
    if (jinaText.length > text.length) text = jinaText;
  }

  return text.slice(0, PAGE_TEXT_MAX_CHARS);
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as { url?: string };
  const url = normalizeUrl(String(body.url ?? ""));
  if (!url) return NextResponse.json({ error: "missing_url" }, { status: 400 });

  let pageText = "";
  try {
    pageText = await loadPageText(url);
  } catch {
    return NextResponse.json(
      { error: "fetch_failed", message: "לא הצלחנו לטעון את הדף. נסו שוב או העתיקו טקסט ידנית." },
      { status: 400 }
    );
  }

  if (!pageText.trim()) {
    return NextResponse.json(
      {
        error: "empty_page",
        message: "הדף חזר ריק — דפי ארבוקס לפעמים נטענים ב-JS בלבד. נסו קישור ישיר לדף מנויים או הזינו מנויים ידנית.",
      },
      { status: 400 }
    );
  }

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return NextResponse.json({ error: "missing_anthropic_key" }, { status: 500 });

  const prompt = `נתח את הטקסט הבא שנלקח מדף אינטרנט של מנויים/חבילות (לרוב Arbox — membership, plans, punch cards).

כתובת הדף: ${url}

חלץ מנויים חודשיים/מנויים מתמשכים וכרטיסיות/חבילות כניסות. אם סוג מסוים לא מופיע — החזר מערך ריק.
שמות ומחירים כפי שמופיעים בטקסט (אפשר בעברית או באנגלית). monthly_sessions = מספר אימונים/כניסות לחודש אם מצוין, אחרת "".

החזר אובייקט JSON תקף בלבד — בלי טקסט לפני או אחרי, בלי markdown.

מבנה:
{
  "membership_tiers": [
    {
      "name": "שם המנוי",
      "price": "מחיר כפי שמופיע",
      "monthly_sessions": "מספר לחודש או ריק",
      "notes": "תנאים, התחייבות, מה כלול — קצר"
    }
  ],
  "punch_cards": [
    {
      "session_count": "מספר אימונים/כניסות",
      "validity": "תוקף אם מצוין",
      "notes": "הערות קצרות"
    }
  ]
}

טקסט הדף:
${pageText}`;

  const client = new Anthropic({ apiKey });
  let text = "";
  try {
    const response = await client.messages.create({
      model: CLAUDE_FETCH_SITE_MODEL,
      max_tokens: CLAUDE_FETCH_SITE_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });
    text = mergeClaudeTextContent(response.content as { type: string; text?: string }[]);
  } catch (e) {
    console.warn("[fetch-arbox-memberships] Claude failed:", e);
    return NextResponse.json(
      { error: "ai_failed", message: "ניתוח המנויים נכשל. נסו שוב או מלאו ידנית." },
      { status: 500 }
    );
  }

  let parsed = tryParseJsonFromAi(text);
  if (!parsed) {
    const compactPrompt = `You must output ONE valid JSON object only. No markdown, no explanation, no text before or after.

Keys (exact): "membership_tiers" (array), "punch_cards" (array).

Each membership_tiers item: {"name","price","monthly_sessions","notes"} strings.
Each punch_cards item: {"session_count","validity","notes"} strings.

Use empty arrays if nothing found. Page URL: ${url}

Page text:
${pageText.slice(0, 6000)}`;

    try {
      const fb = await client.messages.create({
        model: CLAUDE_FETCH_SITE_MODEL,
        max_tokens: CLAUDE_FETCH_SITE_FALLBACK_MAX_TOKENS,
        messages: [{ role: "user", content: compactPrompt }],
      });
      const fbText = mergeClaudeTextContent(fb.content as { type: string; text?: string }[]);
      parsed = tryParseJsonFromAi(fbText);
      if (parsed) text = fbText;
    } catch (e2) {
      console.warn("[fetch-arbox-memberships] Claude fallback failed:", e2);
    }
  }

  if (!parsed) {
    console.warn(
      "[fetch-arbox-memberships] JSON parse failed. Raw prefix:",
      text.slice(0, 500).replace(/\s+/g, " ")
    );
    return NextResponse.json(
      {
        error: "ai_parse_failed",
        message:
          "לא הצלחנו לפרק את תוצאת הניתוח. נסו שוב בעוד רגע; אם זה חוזר — מלאו את המנויים ידנית (דפי ארבוקס לפעמים חוסמים סריקה).",
      },
      { status: 422 }
    );
  }

  const normalized = normalizeArboxKeys(parsed);
  const tiersRaw = Array.isArray(normalized.membership_tiers)
    ? normalized.membership_tiers
    : [];
  const cardsRaw = Array.isArray(normalized.punch_cards) ? normalized.punch_cards : [];

  const membership_tiers = tiersRaw
    .map((t: unknown) => {
      if (!t || typeof t !== "object") return null;
      const o = t as Record<string, unknown>;
      return {
        name: String(o.name ?? o.title ?? "").trim(),
        price: String(o.price ?? o.price_text ?? "").trim(),
        monthly_sessions: String(
          o.monthly_sessions ?? o.monthlySessions ?? o.sessions_per_month ?? ""
        ).trim(),
        notes: String(o.notes ?? o.description ?? "").trim(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.name || x.price || x.monthly_sessions || x.notes))
    .slice(0, 24);

  const punch_cards = cardsRaw
    .map((c: unknown) => {
      if (!c || typeof c !== "object") return null;
      const o = c as Record<string, unknown>;
      return {
        session_count: String(o.session_count ?? o.sessionCount ?? o.sessions ?? "").trim(),
        validity: String(o.validity ?? o.expiry ?? o.duration ?? "").trim(),
        notes: String(o.notes ?? o.description ?? "").trim(),
      };
    })
    .filter(
      (x): x is NonNullable<typeof x> =>
        x !== null && Boolean(x.session_count || x.validity || x.notes)
    )
    .slice(0, 24);

  if (!membership_tiers.length && !punch_cards.length) {
    return NextResponse.json({
      membership_tiers: [],
      punch_cards: [],
      warning: "no_items_found",
      message:
        "לא זוהו מנויים או כרטיסיות בטקסט. ייתכן שהדף נטען דינמית — נסו קישור אחר או מלאו ידנית.",
    });
  }

  return NextResponse.json({ membership_tiers, punch_cards });
}
