import { NextRequest, NextResponse } from "next/server";
import { truncateTrialServiceName } from "@/lib/trial-service";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveClaudeApiKey } from "@/lib/server-env";
import dns from "dns/promises";
import net from "net";
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

function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;
  // IPv6 loopback / link-local / unique local
  if (ip === "::1") return true;
  if (ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd")) return true;
  if (ip.toLowerCase().startsWith("fe80:")) return true;

  const parts = ip.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false;
  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local incl. metadata
  if (a === 0) return true;
  return false;
}

async function assertSafePublicUrl(input: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "invalid_protocol" };
  // Prefer https to reduce MITM surface (allow http only for now)
  const host = u.hostname;
  if (!host) return { ok: false, error: "invalid_host" };
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, error: "blocked_host" };

  // Block credentials in URL (user:pass@host)
  if (u.username || u.password) return { ok: false, error: "blocked_credentials" };

  // DNS resolution guard against internal networks
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length) return { ok: false, error: "dns_failed" };
    if (addrs.some((a) => isPrivateIp(a.address))) return { ok: false, error: "blocked_private_ip" };
  } catch {
    return { ok: false, error: "dns_failed" };
  }

  return { ok: true, url: u.toString() };
}

function scoreBookingUrl(url: string): number {
  const u = url.toLowerCase();
  if (u.includes("arbox")) return 100;
  if (u.includes("mindbody")) return 90;
  if (u.includes("calendly")) return 85;
  if (u.includes("acuityscheduling") || u.includes("acuity")) return 82;
  if (u.includes("booksy")) return 80;
  if (u.includes("simplybook")) return 75;
  if (u.includes("setmore")) return 72;
  if (u.includes("youcanbook")) return 70;
  if (u.includes("10to8")) return 68;
  return 50;
}

function isBookingSchedulingUrl(fullUrl: string): boolean {
  try {
    const u = new URL(fullUrl);
    const h = u.hostname.toLowerCase();
    const hay = `${h}${u.pathname}`.toLowerCase();
    return (
      hay.includes("arbox") ||
      hay.includes("mindbody") ||
      hay.includes("calendly") ||
      hay.includes("acuity") ||
      hay.includes("booksy") ||
      hay.includes("simplybook") ||
      hay.includes("setmore") ||
      hay.includes("youcanbook") ||
      hay.includes("10to8")
    );
  } catch {
    return false;
  }
}

/** חילוץ קישורי מערכות שעות/הזמנה מה-HTML (ארבוקס, Mindbody, Calendly וכו׳) */
function extractBookingUrlCandidates(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const found = new Set<string>();
  const tryAdd = (raw: string) => {
    const v = raw.trim();
    if (!v || v.startsWith("#") || /^javascript:/i.test(v) || /^mailto:/i.test(v)) return;
    try {
      const abs =
        v.startsWith("//")
          ? new URL(`https:${v}`)
          : v.startsWith("/")
            ? new URL(v, base.origin)
            : new URL(v, base.origin);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
      if (!isBookingSchedulingUrl(abs.href)) return;
      found.add(abs.href);
    } catch {
      /* skip */
    }
  };

  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    tryAdd(m[1]);
  }
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)\]}]+/gi)) {
    let s = m[0];
    s = s.replace(/[),.;]+$/g, "");
    tryAdd(s);
  }

  return [...found].sort((a, b) => scoreBookingUrl(b) - scoreBookingUrl(a));
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

function extractPhoneCandidates(html: string, pageText: string): string[] {
  const src = `${html}\n${pageText}`.replace(/\s+/g, " ");
  const found = new Set<string>();

  // Israeli + international-ish formats (keep permissive; UI/user will verify)
  const re = /(\+?\d[\d\s().-]{6,}\d)/g;
  for (const m of src.matchAll(re)) {
    const raw = String(m[1] ?? "").trim();
    if (!raw) continue;
    const digits = raw.replace(/[^\d+]/g, "");
    const plainDigits = digits.replace(/[^\d]/g, "");
    if (plainDigits.length < 9 || plainDigits.length > 15) continue;
    // Filter out obvious non-phones (years / ids) by requiring at least one separator in the original
    if (!/[().\s-]/.test(raw) && !raw.startsWith("+")) continue;
    found.add(raw);
  }

  return [...found].slice(0, 6);
}

function stripJsonTrailingCommas(s: string): string {
  return s.replace(/,(\s*[}\]])/g, "$1");
}

/** אובייקט JSON מאוזן לפי סוגריים — עדיף על lastIndexOf כשיש טקסט אחרי ה-JSON */
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

function tryParseSiteJson(text: string): Record<string, unknown> | null {
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

function heuristicScanPayload(params: {
  url: string;
  metaHints: string;
  bookingCandidates: string[];
  logoCandidate: string;
  rawAiText?: string;
}): Record<string, unknown> {
  const host = (() => {
    try {
      return new URL(params.url).hostname;
    } catch {
      return "";
    }
  })();
  const nicheGuess = guessNicheFromHost(host);
  const nameGuess = guessBusinessNameFromMeta(params.metaHints, host);
  const scheduleUrl = (params.bookingCandidates[0] ?? "").trim();
  const tag =
    params.metaHints.split(" | ")[0]?.trim() || `עסק בתחום ${nicheGuess}.`;
  return {
    niche: nicheGuess,
    business_name: nameGuess,
    tagline: tag,
    address: "",
    directions: "",
    schedule_booking_url: scheduleUrl,
    business_description: tag,
    business_traits: [] as string[],
    logo_url: params.logoCandidate,
    schedule_text: "",
    age_range: "",
    gender: "הכול",
    products: [] as unknown[],
    warning: "ai_parse_failed_heuristic_used",
    message:
      "תוצאת הניתוח לא נפרסה במלואה; מילאנו לפי כותרת, תיאור וקישורים מהדף. מומלץ לעבור על השדות ולערוך.",
    details: params.rawAiText ? String(params.rawAiText).slice(0, 500) : "",
  };
}

function guessBusinessNameFromMeta(metaHints: string, hostname: string): string {
  const first = metaHints.split(" | ")[0]?.trim() ?? "";
  if (first && first.length < 120) {
    const short = first.split(/\s*[|\u2013\u2014-]\s*/)[0]?.trim() ?? "";
    if (short.length >= 2 && short.length < 80) return short;
  }
  const h = hostname.replace(/^www\./i, "");
  const seg = h.split(".")[0] ?? "";
  if (seg && seg.length >= 2) {
    return seg
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "";
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
  const normalized = normalizeWebsiteUrl(String(website_url ?? ""));
  const safe = await assertSafePublicUrl(normalized);
  if (!safe.ok) {
    return NextResponse.json(
      { error: "unsafe_website_url", message: "כתובת האתר אינה נתמכת לסריקה אוטומטית. אנא הזן כתובת ציבורית תקינה." },
      { status: 400 }
    );
  }
  const url = safe.url;
  if (!url) return NextResponse.json({ error: "missing_website_url" }, { status: 400 });

  let pageText = "";
  let logoCandidate = "";
  let metaHints = "";
  let bookingCandidates: string[] = [];
  let phoneCandidates: string[] = [];
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
    bookingCandidates = extractBookingUrlCandidates(html, url);
    pageText = decodeHtmlEntities(stripHtmlToText(html)).slice(0, PAGE_TEXT_MAX_CHARS);
    phoneCandidates = extractPhoneCandidates(html, pageText);
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
- business_name: שם העסק כפי שמופיע בכותרת האתר או בלוגו — קצר, בלי "| אתר רשמי" ובלי סלוגן ארוך.
- tagline: משפט תיאור עסק אחד קצר ומזמין בעברית (כמו תת-כותרת), עד ~20 מילים.
- address: כתובת פיזית אם מופיעה.
- directions: הנחיות הגעה/חניה/כניסה אם מופיעות (או ריק).
- customer_service_phone: מספר טלפון לשירות לקוחות/יצירת קשר אם מופיע (אפשר גם נייד). אם יש רשימת "טלפונים גולמיים" למטה — העתק אחד מהם בדיוק.
- schedule_booking_url: קישור https מלא למערכת שעות/הרשמה (Arbox, Mindbody, Acuity, Calendly וכו׳). אם יש רשימת "קישורים גולמיים" למטה — העתק אחד מהם בדיוק (עדיפות לראשון ברשימה אם זה ארבוקס/Mindbody).
- business_traits: מערך של 3–8 משפטים קצרים בעברית, כל משפט עד 5–6 מילים — מאפיינים ששווה לציין (רמות, גודל מקום, מתאים ל…).
ב-products לכל פריט:
- name: שם קצר לכפתור WhatsApp — עד 15 תווים, 2–3 מילים בלבד. רע: "שיעורי אקרו יוגה שבועיים". טוב: "אקרו יוגה" או "שיעורי אקרו".
- description: תיאור מדויק מהאתר (עדיף להעתיק כמעט כפי שהוא) — 1–3 משפטים קצרים. אם באתר כתוב "שיעור/שיעורי" השאר זאת כ"שיעור/שיעורי" (אל תהפוך ל"אימון"). אם הניסוח כבר מספק וברור — אל תערוך, רק תקן מעט מאוד רווחים/נקודות. המטרה היא שהתיאור יתאים ישירות לניסוח "שיעורי X מתמקדים..." או "אימון X הוא..." בדשבורד.
- flow_features: משפט אחד קצר וחי בעברית לשדה "תיאור" בפלואו (לא רשימה, לא בולטים, לא " · "). אורך דומה ל־10–18 מילים. דוגמה לסגנון: "שיעורים לכל הרמות באווירה הכי כיפית שיש". סינתז מנישה + תיאור + benefits; גם בלי אתר — מהנישה בלבד. דוגמה קלט: תגיות "חוזק · קהילה" → פלט עדיין משפט אחד רציף, לא רשימה.
- benefits: עד 4 תגיות קצרות (חומר עזר לסינתזת flow_features; לפלואו חשוב flow_features כמשפט קצר).
- benefit_suggestions: אופציונלי, הצעות קצרות.
ככל הניתן כלול מחיר ומיקום מטקסט האתר.
business_description: אותו תוכן כמו tagline או סיכום קצר מאוד (לתאימות).
חשוב: החזר אובייקט JSON תקף בלבד — בלי טקסט לפני או אחרי, בלי markdown. אם אין מספיק מקום — החזר "products": [] ו-"business_traits": [].
החזר JSON במבנה:
{
  "niche": "נישה קצרה ומדויקת",
  "business_name": "שם העסק מהאתר",
  "tagline": "משפט תיאור עסק אחד בעברית",
  "address": "",
  "directions": "",
  "customer_service_phone": "",
  "schedule_booking_url": "",
  "business_description": "כמו tagline או ריק",
  "business_traits": ["מאפיין קצר 1", "מאפיין קצר 2", "מאפיין קצר 3"],
  "logo_url": "URL ללוגו או favicon אם קיים",
  "schedule_text": "שעות בפורמט: יום שני: ... \\nיום שלישי: ... (או ריק)",
  "age_range": "18-25 או 25-40 או 40-60 או 60+ או ריק",
  "gender": "זכר או נקבה או הכול",
  "products": [
    {
      "name": "עד 15 תווים",
      "description": "תיאור קצר",
      "price_text": "מחיר אם נמצא",
      "location_text": "מיקום אם נמצא",
      "flow_features": "שיעורים לכל הרמות באווירה הכי כיפית שיש",
      "benefits": ["תגיות עזר"],
      "benefit_suggestions": ["הצעות"]
    }
  ]
}

קישורים גולמיים שנחלצו מקוד הדף למערכות הזמנה (השתמש באחד ל-schedule_booking_url אם רלוונטי):
${bookingCandidates.length ? bookingCandidates.slice(0, 10).join("\n") : "לא אותרו — חפש בטקסט האתר למטה."}

טלפונים גולמיים שנחלצו מהדף (השתמש באחד ל-customer_service_phone אם רלוונטי):
${phoneCandidates.length ? phoneCandidates.join("\n") : "לא אותרו — חפש בטקסט האתר למטה."}

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
קישורי הזמנה מהדף: ${bookingCandidates.slice(0, 5).join(" | ") || "אין"}
טקסט (מקוצר): ${pageText.slice(0, 2600)}
מבנה:
{"niche":"","business_name":"","tagline":"","address":"","directions":"","schedule_booking_url":"","business_description":"","business_traits":[],"logo_url":"","schedule_text":"","age_range":"","gender":"הכול","products":[{"name":"","description":"","price_text":"","location_text":"","flow_features":"","benefits":[],"benefit_suggestions":[]}]}`;
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
    const nameGuess = guessBusinessNameFromMeta(metaHints, fallbackHost);
    return NextResponse.json({
      niche: nicheGuess,
      business_name: nameGuess,
      tagline: metaHints || `עסק בתחום ${nicheGuess}.`,
      address: "",
      directions: "",
      customer_service_phone: phoneCandidates[0] ?? "",
      schedule_booking_url: bookingCandidates[0] ?? "",
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

  const parsed = tryParseSiteJson(text);
  if (!parsed) {
    return NextResponse.json(
      heuristicScanPayload({
        url,
        metaHints,
        bookingCandidates,
        logoCandidate,
        rawAiText: text,
      })
    );
  }

  try {
    const traitsRaw = Array.isArray(parsed.business_traits)
      ? parsed.business_traits.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 12)
      : [];
    const taglineStr =
      typeof parsed.tagline === "string" && parsed.tagline.trim()
        ? parsed.tagline.trim()
        : typeof parsed.business_description === "string"
          ? parsed.business_description.trim().split(/\n/)[0]?.trim() ?? ""
          : "";
    const hostForName = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })();
    let businessName =
      typeof parsed.business_name === "string" ? parsed.business_name.trim() : "";
    if (!businessName) {
      businessName = guessBusinessNameFromMeta(metaHints, hostForName);
    }
    const fromAiSchedule =
      typeof parsed.schedule_booking_url === "string" ? parsed.schedule_booking_url.trim() : "";
    /** עדיפות לקישור שחולץ מ-HTML (ארבוקס וכו׳) — המודל לפעמים מפספס */
    const scheduleUrl = (bookingCandidates[0] || fromAiSchedule).trim();
    const phoneFromAi =
      typeof (parsed as any).customer_service_phone === "string"
        ? String((parsed as any).customer_service_phone).trim()
        : "";
    const phone = (phoneFromAi || phoneCandidates[0] || "").trim();
    return NextResponse.json({
      niche: typeof parsed.niche === "string" ? parsed.niche : "",
      business_name: businessName,
      tagline: taglineStr,
      address: typeof parsed.address === "string" ? parsed.address.trim() : "",
      directions: typeof parsed.directions === "string" ? parsed.directions.trim() : "",
      customer_service_phone: phone,
      schedule_booking_url: scheduleUrl,
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
      products: Array.isArray(parsed.products)
        ? parsed.products.slice(0, 8).map((raw: unknown) => {
            const p = raw as Record<string, unknown>;
            return {
              ...p,
              name: truncateTrialServiceName(String(p.name ?? "")),
            };
          })
        : [],
    });
  } catch {
    return NextResponse.json(
      heuristicScanPayload({
        url,
        metaHints,
        bookingCandidates,
        logoCandidate,
        rawAiText: text,
      })
    );
  }
}

