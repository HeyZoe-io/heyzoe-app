import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveClaudeApiKey } from "@/lib/server-env";
import {
  CLAUDE_FETCH_SITE_MODEL,
  CLAUDE_FETCH_SITE_MAX_TOKENS,
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

function tryParseJsonFromAi(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/^\uFEFF/, "")
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/i, "")
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
  const balanced = extractBalancedJsonObject(cleaned);
  if (balanced) candidates.push(balanced);
  candidates.push(cleaned);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = cleaned.slice(start, end + 1);
    if (!candidates.includes(slice)) candidates.push(slice);
  }

  for (const raw of candidates) {
    const repaired = stripJsonTrailingCommas(raw);
    const p = tryParse(repaired);
    if (p) return p;
  }
  return null;
}

async function loadPageText(url: string): Promise<string> {
  let res = await fetchWithTimeout(url, { redirect: "follow", headers: BROWSER_HEADERS });
  let html = res.ok ? await res.text() : "";
  let text = decodeHtmlEntities(stripHtmlToText(html));

  if (text.length < 700) {
    const jina = `https://r.jina.ai/${encodeURIComponent(url)}`;
    const jRes = await fetchWithTimeout(jina, { headers: BROWSER_HEADERS });
    if (jRes.ok) {
      const jBody = await jRes.text();
      const jText = decodeHtmlEntities(stripHtmlToText(jBody));
      if (jText.length > text.length) text = jText;
    }
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
    text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  } catch (e) {
    console.warn("[fetch-arbox-memberships] Claude failed:", e);
    return NextResponse.json(
      { error: "ai_failed", message: "ניתוח המנויים נכשל. נסו שוב או מלאו ידנית." },
      { status: 500 }
    );
  }

  const parsed = tryParseJsonFromAi(text);
  if (!parsed) {
    return NextResponse.json(
      {
        error: "ai_parse_failed",
        message: "לא הצלחנו לפרק את תוצאת הניתוח. נסו שוב או ערכו את הרשימה ידנית.",
      },
      { status: 422 }
    );
  }

  const tiersRaw = Array.isArray(parsed.membership_tiers) ? parsed.membership_tiers : [];
  const cardsRaw = Array.isArray(parsed.punch_cards) ? parsed.punch_cards : [];

  const membership_tiers = tiersRaw
    .map((t: unknown) => {
      if (!t || typeof t !== "object") return null;
      const o = t as Record<string, unknown>;
      return {
        name: String(o.name ?? "").trim(),
        price: String(o.price ?? "").trim(),
        monthly_sessions: String(o.monthly_sessions ?? "").trim(),
        notes: String(o.notes ?? "").trim(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && Boolean(x.name || x.price || x.monthly_sessions || x.notes))
    .slice(0, 24);

  const punch_cards = cardsRaw
    .map((c: unknown) => {
      if (!c || typeof c !== "object") return null;
      const o = c as Record<string, unknown>;
      return {
        session_count: String(o.session_count ?? "").trim(),
        validity: String(o.validity ?? "").trim(),
        notes: String(o.notes ?? "").trim(),
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
