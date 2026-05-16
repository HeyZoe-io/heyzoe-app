import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES } from "@/lib/business-zoe-platform-defaults";
import type { ZoePlatformCategory, ZoePlatformGuidelines } from "@/lib/business-zoe-platform-types";

export type { ZoePlatformCategory, ZoePlatformGuidelines } from "@/lib/business-zoe-platform-types";
export { DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES } from "@/lib/business-zoe-platform-defaults";

const CACHE_TTL_MS = 60_000;

type CacheEntry = { at: number; v: ZoePlatformGuidelines };

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as unknown as { __hzZoePlatformCache?: Map<string, CacheEntry> };
  if (!g.__hzZoePlatformCache) g.__hzZoePlatformCache = new Map();
  return g.__hzZoePlatformCache;
}

function parseCategories(raw: unknown): ZoePlatformCategory[] | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { categories?: unknown };
  if (!Array.isArray(o.categories) || o.categories.length === 0) return null;
  const out: ZoePlatformCategory[] = [];
  for (const item of o.categories) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const id = String(c.id ?? "").trim();
    const title = String(c.title ?? "").trim();
    if (!id || !title) continue;
    const lines = Array.isArray(c.lines)
      ? c.lines.map((x) => String(x ?? "").trim()).filter(Boolean).map((s) => s.slice(0, 1200))
      : [];
    out.push({
      id: id.slice(0, 64),
      title: title.slice(0, 120),
      description: String(c.description ?? "").trim().slice(0, 500),
      lines: lines.slice(0, 80),
    });
  }
  return out.length ? out : null;
}

/** ממזג שמור ב-DB עם ברירת מחדל — קטגוריות חסרות נשארות מהקוד */
export function mergeWithDefaultZoePlatform(stored: ZoePlatformGuidelines | null): ZoePlatformGuidelines {
  const defaults = DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories;
  if (!stored?.categories?.length) return DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES;
  const byId = new Map(stored.categories.map((c) => [c.id, c]));
  const merged: ZoePlatformCategory[] = defaults.map((def) => byId.get(def.id) ?? def);
  for (const c of stored.categories) {
    if (!defaults.some((d) => d.id === c.id)) merged.push(c);
  }
  return { categories: merged };
}

export function isUsingDefaultZoePlatform(stored: ZoePlatformGuidelines | null): boolean {
  return !stored?.categories?.length;
}

export async function loadZoePlatformGuidelines(): Promise<ZoePlatformGuidelines> {
  const cache = getCache();
  const key = "platform";
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.v;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("zoe_platform_settings")
      .select("guidelines")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      if (/zoe_platform_settings|guidelines|column|relation/i.test(error.message)) {
        const v = DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES;
        cache.set(key, { at: now, v });
        return v;
      }
      console.warn("[zoe-platform] load failed:", error.message);
      const v = DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES;
      cache.set(key, { at: now, v });
      return v;
    }
    const parsed = parseCategories((data as { guidelines?: unknown } | null)?.guidelines);
    const v = mergeWithDefaultZoePlatform(parsed ? { categories: parsed } : null);
    cache.set(key, { at: now, v });
    return v;
  } catch (e) {
    console.warn("[zoe-platform] load exception:", e);
    const v = DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES;
    cache.set(key, { at: now, v });
    return v;
  }
}

export function invalidateZoePlatformGuidelinesCache(): void {
  getCache().delete("platform");
}

export function getZoePlatformCategory(
  guidelines: ZoePlatformGuidelines,
  categoryId: string
): ZoePlatformCategory | undefined {
  return guidelines.categories.find((c) => c.id === categoryId);
}

export function getZoePlatformCategoryBlock(guidelines: ZoePlatformGuidelines, categoryId: string): string {
  const cat = getZoePlatformCategory(guidelines, categoryId);
  if (!cat?.lines.length) return "";
  const header = `【${cat.title}】`;
  const body = cat.lines.map((t, i) => `${i + 1}. ${t}`).join("\n");
  return `${header}\n${body}`;
}

const PLATFORM_CATEGORY_IDS_INJECTED_ELSEWHERE = new Set([
  "identity",
  "legal_rules",
  "tone_analysis",
  "vibe_tags",
  "response_web",
  "response_wa",
  "response_wa_pre_cta",
  "response_wa_post_trial",
  "unknown_knowledge",
  "channel_whatsapp",
  "channel_web",
  "sales_flow_meta",
]);

/** קטגוריות מותאמות אישית + כל מה שלא מוזרק ישירות לפרומפט */
export function buildZoePlatformPromptSection(guidelines: ZoePlatformGuidelines): string {
  const blocks = guidelines.categories
    .filter((c) => !PLATFORM_CATEGORY_IDS_INJECTED_ELSEWHERE.has(c.id))
    .map((c) => {
      if (!c.lines.length) return "";
      const desc = c.description.trim() ? ` (${c.description})` : "";
      return `### ${c.title}${desc}\n${c.lines.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
    })
    .filter(Boolean);
  if (!blocks.length) return "";
  return `\n\nהנחיות נוספות (קטגוריות מותאמות):\n${blocks.join("\n\n")}`;
}

/** מפה מתגית ויב → הנחיה, מקטגוריית vibe_tags */
export function buildVibeLinesMapFromPlatform(guidelines: ZoePlatformGuidelines): Record<string, string> {
  const cat = getZoePlatformCategory(guidelines, "vibe_tags");
  const map: Record<string, string> = {};
  if (!cat) return map;
  for (const line of cat.lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const label = line.slice(0, idx).trim();
    const instruction = line.slice(idx + 1).trim();
    if (label && instruction) map[label] = instruction;
  }
  return map;
}

export function sanitizeZoePlatformForSave(raw: unknown): ZoePlatformGuidelines {
  const parsed = parseCategories(raw);
  if (!parsed) return { categories: [] };
  return { categories: parsed.slice(0, 24) };
}
