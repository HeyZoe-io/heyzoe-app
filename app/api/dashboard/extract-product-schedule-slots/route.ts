import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import dns from "dns/promises";
import net from "net";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { resolveClaudeApiKey } from "@/lib/server-env";
import { CLAUDE_CHAT_MODEL } from "@/lib/claude";

export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 14_000;
const MAX_DOWNLOAD_BYTES = 4_000_000;
const TEXT_EXTRACT_MAX = 14_000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/*,*/*;q=0.8",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;
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
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

async function assertSafePublicUrl(input: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "invalid_protocol" };
  const host = u.hostname;
  if (!host) return { ok: false, error: "invalid_host" };
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, error: "blocked_host" };
  if (u.username || u.password) return { ok: false, error: "blocked_credentials" };
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length) return { ok: false, error: "dns_failed" };
    if (addrs.some((a) => isPrivateIp(a.address))) return { ok: false, error: "blocked_private_ip" };
  } catch {
    return { ok: false, error: "dns_failed" };
  }
  return { ok: true, url: u.toString() };
}

async function fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveImageMediaType(mime: string): ImageMediaType | null {
  const m = mime.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "image/jpeg";
  if (m.includes("png")) return "image/png";
  if (m.includes("gif")) return "image/gif";
  if (m.includes("webp")) return "image/webp";
  return null;
}

function sniffIsImage(buf: Buffer): ImageMediaType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return "image/webp";
  return null;
}

type SlotRow = { day: string; time: string };
type ServiceSlots = { name: string; slots: SlotRow[] };

type ClaudeUserContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: ImageMediaType; data: string } };

function extractJsonObject(text: string): unknown {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence?.[1] ?? t).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function normalizeSlotRow(o: unknown): SlotRow | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const dayRaw = String(r.day ?? r.day_letter ?? "").trim();
  const time = String(r.time ?? "").trim();
  const dayClean = dayRaw
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu, "")
    .trim();
  const dayLower = dayClean.toLowerCase();

  // Prefer full Hebrew day names when present (avoids ambiguity: "שישי" starts with ש).
  const byName: Record<string, SlotRow["day"]> = {
    "ראשון": "א",
    "יום ראשון": "א",
    "שני": "ב",
    "יום שני": "ב",
    "שלישי": "ג",
    "יום שלישי": "ג",
    "רביעי": "ד",
    "יום רביעי": "ד",
    "חמישי": "ה",
    "יום חמישי": "ה",
    "שישי": "ו",
    "יום שישי": "ו",
    "שבת": "ש",
    "יום שבת": "ש",
  };
  let d0: string = "";
  for (const [k, v] of Object.entries(byName)) {
    if (dayLower.includes(k)) {
      d0 = v;
      break;
    }
  }
  if (!d0) {
    const first = [...dayClean][0] ?? "";
    if (!first || !/[א-ת]/u.test(first)) return null;
    d0 = first;
  }

  // Only allow our canonical letters: א ב ג ד ה ו ש
  if (!/^[אבגדהוש]$/u.test(d0)) return null;
  const tm = time.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!tm) return null;
  const h = Number(tm[1]);
  const min = Number(tm[2]);
  return { day: d0, time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
}

function parseServicesPayload(parsed: unknown): ServiceSlots[] {
  if (!parsed || typeof parsed !== "object") return [];
  const rec = parsed as Record<string, unknown>;
  const rawList = (rec.services ?? rec.items) as unknown;
  if (!Array.isArray(rawList)) return [];
  const out: ServiceSlots[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? o.service_name ?? "").trim();
    const slotsRaw = o.slots;
    if (!name || !Array.isArray(slotsRaw)) continue;
    const slots: SlotRow[] = [];
    for (const s of slotsRaw) {
      const row = normalizeSlotRow(s);
      if (row) slots.push(row);
    }
    out.push({ name, slots });
  }
  return out;
}

function bestMatchCanonicalName(aiName: string, candidates: string[]): string | null {
  const a = aiName.trim().toLowerCase();
  if (!a) return null;
  for (const c of candidates) {
    const cc = c.trim();
    if (!cc) continue;
    if (cc.toLowerCase() === a) return cc;
  }
  for (const c of candidates) {
    const cc = c.trim();
    if (!cc) continue;
    const lc = cc.toLowerCase();
    if (lc.includes(a) || a.includes(lc)) return cc;
  }
  return null;
}

function mapToCanonicalNames(services: ServiceSlots[], canonical: string[]): ServiceSlots[] {
  const map = new Map<string, SlotRow[]>();
  for (const s of services) {
    const key = bestMatchCanonicalName(s.name, canonical);
    if (!key) continue;
    const prev = map.get(key) ?? [];
    prev.push(...s.slots);
    map.set(key, prev);
  }
  const merged = new Map<string, SlotRow[]>();
  for (const [k, slots] of map) {
    const dedup = new Map<string, SlotRow>();
    for (const sl of slots) {
      dedup.set(`${sl.day}|${sl.time}`, sl);
    }
    merged.set(k, [...dedup.values()]);
  }

  return canonical.map((name) => ({
    name,
    slots: merged.get(name) ?? [],
  }));
}

function decodeBasicHtmlAttr(s: string): string {
  return String(s ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .trim();
}

/** ניקוד לבחירת תמונות שסביר שייצגו לוח שעות (לא באנר/לוגו קטן). */
function scheduleImageUrlScore(url: string): number {
  let u = url.toLowerCase();
  try {
    u = decodeURIComponent(u).toLowerCase();
  } catch {
    /* keep ascii-only u */
  }
  let s = 0;
  if (/\.(jpe?g|png|webp)(\?|#|$)/i.test(u)) s += 3;
  if (/schedule|לוח|שעות|מערכת|timetable|weekly|sep[-_]?schedule/i.test(u)) s += 4;
  if (/יוגה|yoga|class|שיעור/i.test(u)) s += 1;
  if (/banner|logo|icon|favicon|pixel|tracking|spacer|1x1/i.test(u)) s -= 5;
  return s;
}

function extractImageUrlsFromHtml(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const found = new Set<string>();
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    const tag = m[0] ?? "";
    const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const dataSrcMatch = tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i);
    const raw = (srcMatch?.[1] ?? dataSrcMatch?.[1])?.trim();
    if (!raw || raw.startsWith("data:")) continue;
    const src = decodeBasicHtmlAttr(raw);
    try {
      const abs = new URL(src, base).href;
      if (abs.startsWith("http://") || abs.startsWith("https://")) found.add(abs);
    } catch {
      /* skip */
    }
  }
  return [...found].sort((a, b) => scheduleImageUrlScore(b) - scheduleImageUrlScore(a));
}

const MAX_IMAGE_FETCH_BYTES = 2_500_000;
const MAX_IMAGES_FOR_VISION = 3;

async function tryFetchImageAsBase64(
  imageUrl: string
): Promise<{ mime: ImageMediaType; b64: string } | null> {
  const safe = await assertSafePublicUrl(imageUrl);
  if (!safe.ok) return null;
  let res: Response;
  try {
    res = await fetchWithTimeout(safe.url, { headers: BROWSER_HEADERS, redirect: "follow" });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4000 || buf.length > MAX_IMAGE_FETCH_BYTES) return null;
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const mime = resolveImageMediaType(ct) ?? sniffIsImage(buf);
  if (!mime) return null;
  return { mime, b64: buf.toString("base64") };
}

function countTotalSlots(rows: ServiceSlots[]): number {
  return rows.reduce((n, s) => n + s.slots.length, 0);
}

async function claudeExtractSchedule(
  client: Anthropic,
  systemRules: string,
  userContent: string | ClaudeUserContentBlock[]
): Promise<ServiceSlots[]> {
  const response = await client.messages.create({
    model: CLAUDE_CHAT_MODEL,
    max_tokens: 4096,
    system: systemRules,
    messages: [{ role: "user", content: userContent }],
  });
  const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  const parsed = extractJsonObject(text);
  return parseServicesPayload(parsed);
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { scheduleUrl?: unknown; services?: unknown };
  try {
    body = (await req.json()) as { scheduleUrl?: unknown; services?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const scheduleUrl = String(body.scheduleUrl ?? "").trim();
  const serviceNames = Array.isArray(body.services)
    ? body.services
        .map((x) => {
          if (!x || typeof x !== "object") return "";
          return String((x as { name?: unknown }).name ?? "").trim();
        })
        .filter(Boolean)
    : [];

  if (!scheduleUrl) return NextResponse.json({ error: "missing_schedule_url" }, { status: 400 });
  if (!serviceNames.length) return NextResponse.json({ error: "missing_services" }, { status: 400 });

  const safe = await assertSafePublicUrl(scheduleUrl);
  if (!safe.ok) return NextResponse.json({ error: safe.error }, { status: 400 });

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return NextResponse.json({ error: "missing_anthropic_key" }, { status: 500 });

  let res: Response;
  try {
    res = await fetchWithTimeout(safe.url, { headers: BROWSER_HEADERS, redirect: "follow" });
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
  if (!res.ok) return NextResponse.json({ error: `fetch_http_${res.status}` }, { status: 502 });

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD_BYTES) {
    return NextResponse.json({ error: "response_too_large" }, { status: 413 });
  }

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const imageMime = resolveImageMediaType(ct) ?? sniffIsImage(buf);

  const namesList = serviceNames.map((n) => `- ${n}`).join("\n");

  const systemRules = [
    "You extract weekly class schedule information for a Hebrew fitness/yoga studio.",
    'Return ONLY JSON (no markdown), shape:',
    '{"services":[{"name":"<exact studio product name from input list>","slots":[{"day":"א|ב|ג|ד|ה|ו|ש","time":"HH:MM"}]}]}',
    "Rules:",
    "- Output ONLY from what is explicitly visible in the timetable. Do NOT guess, infer, or \"fill in\" missing values.",
    "- Ignore calendar dates and date ranges; we only need a weekly timetable.",
    "- Determine the day by the day label you can read (e.g. \"שישי\", \"יום ג׳\"). Do not assume the order of columns.",
    "- day letters: א=Sunday ב=Monday ג=Tuesday ד=Wednesday ה=Thursday ו=Friday ש=Saturday.",
    "- time is 24h HH:MM with leading zeros (e.g. 08:30, 20:30).",
    "- Pay close attention to AM/PM in 24h format: do NOT convert 08:30 → 20:30 (or vice versa) unless the tens digit is clearly visible on the schedule.",
    "- Add a slot ONLY when you can read: (product/class name) + (day) + (time) on the schedule.",
    "- For each product from the input list: include slots where the product name appears clearly on the schedule. If not found, slots must be [].",
    "- Use Hebrew product names EXACTLY as given in the input list for the output 'name'.",
  ].join("\n");

  const client = new Anthropic({ apiKey });

  if (imageMime) {
    const b64 = buf.toString("base64");
    const services = await claudeExtractSchedule(client, systemRules, [
      { type: "image", source: { type: "base64", media_type: imageMime, data: b64 } },
      {
        type: "text",
        text: `Studio products (Hebrew names):\n${namesList}\n\nExtract weekly slots per product from this schedule image.`,
      },
    ]);
    const mapped = mapToCanonicalNames(services, serviceNames);
    return NextResponse.json({
      ok: true,
      mode: "image",
      services: mapped,
      slots_found: countTotalSlots(mapped),
      hint: countTotalSlots(mapped) === 0 ? "no_slots" : undefined,
    });
  }

  const htmlOrText = buf.toString("utf8");
  const extracted = stripHtmlToText(htmlOrText).slice(0, TEXT_EXTRACT_MAX);

  const textServices = await claudeExtractSchedule(
    client,
    systemRules,
    `Studio products (Hebrew names):\n${namesList}\n\nSchedule page text (may be noisy):\n${extracted}`
  );
  let merged = mapToCanonicalNames(textServices, serviceNames);
  let total = countTotalSlots(merged);
  let mode: "html" | "page_images" = "html";

  if (total === 0) {
    const imgUrls = extractImageUrlsFromHtml(htmlOrText, safe.url).slice(0, 12);
    const images: { mime: ImageMediaType; b64: string }[] = [];
    for (const u of imgUrls) {
      const img = await tryFetchImageAsBase64(u);
      if (img) images.push(img);
      if (images.length >= MAX_IMAGES_FOR_VISION) break;
    }
    if (images.length > 0) {
      const blocks: ClaudeUserContentBlock[] = [];
      for (const im of images) {
        blocks.push({ type: "image", source: { type: "base64", media_type: im.mime, data: im.b64 } });
      }
      blocks.push({
        type: "text",
        text: `Studio products (Hebrew names):\n${namesList}\n\nOne or more images above may show the weekly timetable (often a JPEG/PNG). Read Hebrew day names and times for each product. If multiple images, combine all visible slots.`,
      });
      const visServices = await claudeExtractSchedule(client, systemRules, blocks);
      merged = mapToCanonicalNames(visServices, serviceNames);
      total = countTotalSlots(merged);
      mode = "page_images";
    }
  }

  return NextResponse.json({
    ok: true,
    mode,
    services: merged,
    slots_found: total,
    hint: total === 0 ? "no_slots" : undefined,
  });
}
