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

const PAGE_TEXT_MAX_CHARS = 8000;
const FETCH_TIMEOUT_MS = 12_000;

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
    "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&#39;": "'",
    "&lt;": "<", "&gt;": ">", "&ndash;": "-", "&mdash;": "-",
  };
  return input
    .replace(/&(nbsp|amp|quot|#39|lt|gt|ndash|mdash);/g, (m) => named[m] ?? m)
    .replace(/&#(\d+);/g, (_, num) => {
      const n = Number(num);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    });
}

function findLogoCandidate(html: string, pageUrl: string): string {
  const base = new URL(pageUrl);
  const ogImage =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]?.trim() ??
    "";
  if (ogImage) {
    try { return new URL(ogImage, base.origin).toString(); } catch { /* continue */ }
  }

  const logoImgs = [...html.matchAll(/<img[^>]+src=["']([^"']*logo[^"']*)["'][^>]*>/gi)];
  if (logoImgs.length) {
    let best = logoImgs[0][1];
    let bestArea = 0;
    for (const m of logoImgs) {
      const tag = m[0];
      const src = m[1];
      const width = Number(tag.match(/\bwidth=["']?(\d+)/i)?.[1] ?? "0");
      const height = Number(tag.match(/\bheight=["']?(\d+)/i)?.[1] ?? "0");
      const area = width * height;
      if (area >= bestArea) { best = src; bestArea = area; }
    }
    try { return new URL(best, base.origin).toString(); } catch { /* continue */ }
  }

  const iconMatch =
    html.match(/<link[^>]+rel=["'][^"']*(icon|shortcut icon|apple-touch-icon)[^"']*["'][^>]*>/i)?.[0] ?? "";
  const href = iconMatch.match(/href=["']([^"']+)["']/i)?.[1]?.trim() ?? "";
  if (href) {
    try { return new URL(href, base.origin).toString(); } catch { return `${base.origin}/favicon.ico`; }
  }
  return `${base.origin}/favicon.ico`;
}

function normalizeWebsiteUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function extractMetaHints(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1]?.trim() ??
    "";
  const ogTitle =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ?? "";
  const ogDescription =
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ?? "";
  return [title, description, ogTitle, ogDescription].filter(Boolean).join(" | ");
}

function guessNicheFromHost(hostname: string): string {
  const h = hostname.toLowerCase();
  if (/gym|fit|pilates|yoga|studio/.test(h)) return "Fitness";
  if (/clinic|med|doctor|therapy/.test(h)) return "Clinic";
  if (/beauty|skin|hair|nail/.test(h)) return "Beauty";
  if (/school|academy|learn|course/.test(h)) return "Education";
  return "Business";
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { website_url, business_name, niche } = await req.json();
  const url = normalizeWebsiteUrl(String(website_url ?? ""));
  if (!url) return NextResponse.json({ error: "missing_website_url" }, { status: 400 });

  let pageText = "";
  let logoCandidate = "";
  let metaHints = "";
  try {
    let res = await fetchWithTimeout(url, { redirect: "follow", headers: BROWSER_HEADERS });

    if (!res.ok) {
      const withWww = (() => {
        try {
          const u = new URL(url);
          if (u.hostname.startsWith("www.")) return "";
          u.hostname = `www.${u.hostname}`;
          return u.toString();
        } catch { return ""; }
      })();
      if (withWww) res = await fetchWithTimeout(withWww, { redirect: "follow", headers: BROWSER_HEADERS });
    }

    let html = "";
    if (res.ok) {
      html = await res.text();
    } else {
      const mirrorUrl = `https://r.jina.ai/http://${new URL(url).host}${new URL(url).pathname}${new URL(url).search}`;
      const mirrorRes = await fetchWithTimeout(mirrorUrl, { headers: BROWSER_HEADERS });
      if (mirrorRes.ok) html = await mirrorRes.text();
    }

    if (!html.trim()) {
      return NextResponse.json(
        { error: "blocked_auto_scraping", message: "האתר חוסם סריקה אוטומטית, אנא הזן את פרטי העסק ידנית" },
        { status: 400 }
      );
    }

    logoCandidate = findLogoCandidate(html, url);
    metaHints = extractMetaHints(html);
    pageText = decodeHtmlEntities(stripHtmlToText(html)).slice(0, PAGE_TEXT_MAX_CHARS);
  } catch {
    return NextResponse.json(
      { error: "blocked_auto_scraping", message: "האתר חוסם סריקה אוטומטית, אנא הזן את פרטי העסק ידנית" },
      { status: 400 }
    );
  }

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return NextResponse.json({ error: "missing_anthropic_key" }, { status: 500 });

  const thinContent = pageText.length < 900;
  const prompt = `נתח את טקסט האתר הבא של העסק "${business_name ?? ""}" בתחום "${niche ?? ""}".
כתובת אתר: ${url}
רמזי מטא (אם קיימים): ${metaHints || "אין"}
${thinContent ? 'אם התוכן דל/חלקי, בצע "educated guesses" סבירים על בסיס הדומיין, title/meta והקשר העסק.' : ""}
אם שדה מסוים לא נמצא, החזר מחרוזת ריקה "" או מערך ריק [] במקום להיכשל בבקשה.
חלץ מהאתר (או נחש בצורה סבירה אם חסר):
- tagline: משפט תיאור עסק אחד קצר ומזמין בעברית (כמו תת-כותרת), עד ~20 מילים.
- address: כתובת פיזית אם מופיעה.
- directions: הנחיות הגעה/חניה/כניסה אם מופיעות (או ריק).
- schedule_booking_url: קישור ישיר למערכת שעות/הרשמה אם נמצא (Arbox, Mindbody, Acuity, Calendly וכו׳) או ריק.
- business_traits: מערך של 3–8 משפטים קצרים בעברית, כל משפט עד 5–6 מילים — מאפיינים ששווה לציין (רמות, גודל מקום, מתאים ל…).
ב-products החזר שירותים/מוצרים אמיתיים ככל הניתן מתוך האתר, כולל benefits מוסקים.
business_description: אותו תוכן כמו tagline או סיכום קצר מאוד (לתאימות).
החזר JSON בלבד במבנה:
{
  "niche": "נישה קצרה ומדויקת",
  "tagline": "משפט תיאור עסק אחד בעברית",
  "address": "",
  "directions": "",
  "schedule_booking_url": "",
  "business_description": "כמו tagline או ריק",
  "business_traits": ["מאפיין קצר 1", "מאפיין קצר 2", "מאפיין קצר 3"],
  "logo_url": "URL ללוגו או favicon אם קיים",
  "schedule_text": "שעות בפורמט: יום שני: ... \\nיום שלישי: ... (או ריק)",
  "age_range": "18-25 או 25-40 או 40-60 או 60+ או ריק",
  "gender": "זכר או נקבה או הכול",
  "products": [
    {
      "name": "שם שירות",
      "description": "תיאור קצר",
      "price_text": "מחיר אם נמצא",
      "location_text": "מיקום אם נמצא",
      "benefits": ["עד 4 תגיות מה משיגים מהשירות"],
      "benefit_suggestions": ["3-5 בועות הצעה רלוונטיות"]
    }
  ]
}

טקסט אתר:
${pageText}`;

  let text = "";
  let lastError: unknown = null;

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: CLAUDE_FETCH_SITE_MODEL,
      max_tokens: CLAUDE_FETCH_SITE_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });
    text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  } catch (e) {
    lastError = e;
    console.warn("[fetch-site] Claude primary prompt failed:", e);

    // Compact fallback
    const compactPrompt = `החזר JSON בלבד. נתח בקצרה אתר עסקי.
אתר: ${url}
מטא: ${metaHints || "אין"}
טקסט (מקוצר): ${pageText.slice(0, 2600)}
מבנה:
{"niche":"","tagline":"","address":"","directions":"","schedule_booking_url":"","business_description":"","business_traits":[],"logo_url":"","schedule_text":"","age_range":"","gender":"הכול","products":[{"name":"","description":"","price_text":"","location_text":"","benefits":[],"benefit_suggestions":[]}]}`;
    try {
      const fallbackResponse = await client.messages.create({
        model: CLAUDE_FETCH_SITE_MODEL,
        max_tokens: CLAUDE_FETCH_SITE_FALLBACK_MAX_TOKENS,
        messages: [{ role: "user", content: compactPrompt }],
      });
      text = fallbackResponse.content[0]?.type === "text" ? fallbackResponse.content[0].text.trim() : "";
    } catch (e2) {
      lastError = e2;
      console.warn("[fetch-site] Claude compact prompt failed:", e2);
    }
  }

  if (!text) {
    const fallbackHost = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
    const nicheGuess = guessNicheFromHost(fallbackHost);
    return NextResponse.json({
      niche: nicheGuess,
      tagline: metaHints || `עסק בתחום ${nicheGuess}.`,
      address: "",
      directions: "",
      schedule_booking_url: "",
      business_description: metaHints || `עסק בתחום ${nicheGuess}.`,
      business_traits: [] as string[],
      logo_url: logoCandidate,
      schedule_text: "",
      age_range: "",
      gender: "הכול",
      products: [],
      warning: "ai_generation_failed_fallback_used",
      message: "לא הצלחנו לחלץ הכל אוטומטית, מילאנו נתונים בסיסיים מהאתר.",
      details: String(lastError ?? ""),
    });
  }

  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const traitsRaw = Array.isArray(parsed.business_traits)
      ? parsed.business_traits.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 12)
      : [];
    const taglineStr =
      typeof parsed.tagline === "string" && parsed.tagline.trim()
        ? parsed.tagline.trim()
        : typeof parsed.business_description === "string"
          ? parsed.business_description.trim().split(/\n/)[0]?.trim() ?? ""
          : "";
    return NextResponse.json({
      niche: typeof parsed.niche === "string" ? parsed.niche : "",
      tagline: taglineStr,
      address: typeof parsed.address === "string" ? parsed.address.trim() : "",
      directions: typeof parsed.directions === "string" ? parsed.directions.trim() : "",
      schedule_booking_url:
        typeof parsed.schedule_booking_url === "string" ? parsed.schedule_booking_url.trim() : "",
      business_description:
        typeof parsed.business_description === "string" && parsed.business_description.trim()
          ? parsed.business_description.trim()
          : taglineStr,
      business_traits: traitsRaw,
      logo_url:
        typeof parsed.logo_url === "string" && parsed.logo_url.trim()
          ? parsed.logo_url.trim()
          : logoCandidate,
      schedule_text: typeof parsed.schedule_text === "string" ? parsed.schedule_text : "",
      age_range: typeof parsed.age_range === "string" ? parsed.age_range : "",
      gender:
        parsed.gender === "זכר" || parsed.gender === "נקבה" || parsed.gender === "הכול"
          ? parsed.gender
          : "הכול",
      products: Array.isArray(parsed.products) ? parsed.products.slice(0, 8) : [],
    });
  } catch {
    return NextResponse.json({ error: "ai_parse_failed" }, { status: 502 });
  }
}
