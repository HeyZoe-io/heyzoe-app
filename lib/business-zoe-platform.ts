import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES } from "@/lib/business-zoe-platform-defaults";
import type {
  ZoePlatformCategory,
  ZoePlatformGuidelines,
  ZoePlatformSection,
} from "@/lib/business-zoe-platform-types";
import { ZOE_PLATFORM_INTERNAL_KEYS } from "@/lib/business-zoe-platform-defaults";

export type {
  ZoePlatformCategory,
  ZoePlatformGuidelines,
  ZoePlatformSection,
} from "@/lib/business-zoe-platform-types";
export { DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES } from "@/lib/business-zoe-platform-defaults";

const CACHE_TTL_MS = 60_000;
const DISPLAY_CATEGORY_IDS = ["personality", "vibe_tags", "responses", "situations"] as const;

type CacheEntry = { at: number; v: ZoePlatformGuidelines };

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as unknown as { __hzZoePlatformCache?: Map<string, CacheEntry> };
  if (!g.__hzZoePlatformCache) g.__hzZoePlatformCache = new Map();
  return g.__hzZoePlatformCache;
}

function parseSection(raw: unknown): ZoePlatformSection | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const key = String(s.key ?? "").trim().slice(0, 64);
  const label = String(s.label ?? "").trim().slice(0, 120);
  if (!key || !label) return null;
  const lines = Array.isArray(s.lines)
    ? s.lines.map((x) => String(x ?? "").trim()).filter(Boolean).map((l) => l.slice(0, 1200))
    : [];
  return {
    key,
    label,
    hint: String(s.hint ?? "").trim().slice(0, 300),
    lines: lines.slice(0, 80),
  };
}

function parseCategory(raw: unknown): ZoePlatformCategory | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const id = String(c.id ?? "").trim().slice(0, 64);
  const title = String(c.title ?? "").trim().slice(0, 120);
  if (!id || !title) return null;
  const lines = Array.isArray(c.lines)
    ? c.lines.map((x) => String(x ?? "").trim()).filter(Boolean).map((l) => l.slice(0, 1200))
    : [];
  const sections = Array.isArray(c.sections)
    ? c.sections.map(parseSection).filter((x): x is ZoePlatformSection => Boolean(x))
    : undefined;
  return {
    id,
    title,
    description: String(c.description ?? "").trim().slice(0, 500),
    lines: lines.slice(0, 80),
    sections: sections?.length ? sections : undefined,
  };
}

function parseCategories(raw: unknown): ZoePlatformCategory[] | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { categories?: unknown };
  if (!Array.isArray(o.categories) || o.categories.length === 0) return null;
  const out = o.categories.map(parseCategory).filter((x): x is ZoePlatformCategory => Boolean(x));
  return out.length ? out : null;
}

function isDisplayFormat(categories: ZoePlatformCategory[]): boolean {
  return categories.some((c) => DISPLAY_CATEGORY_IDS.includes(c.id as (typeof DISPLAY_CATEGORY_IDS)[number]));
}

/** ממיר שמירה ישנה (12 קטגוריות שטוחות) ל-4 קטגוריות לתצוגה */
export function migrateLegacyCategoriesToDisplay(categories: ZoePlatformCategory[]): ZoePlatformGuidelines {
  if (isDisplayFormat(categories)) return { categories };

  const byId = new Map(categories.map((c) => [c.id, c]));
  const pickLines = (id: string) => byId.get(id)?.lines ?? [];
  const pickMeta = (id: string) => {
    const c = byId.get(id);
    return { label: c?.title ?? id, hint: c?.description ?? "", lines: c?.lines ?? [] };
  };

  return {
    categories: [
      {
        id: "personality",
        title: "זהות, חוקיות ואופי",
        description: DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories[0].description,
        lines: [],
        sections: [
          { key: "identity", label: pickMeta("identity").label, hint: pickMeta("identity").hint, lines: pickLines("identity") },
          { key: "legal_rules", label: pickMeta("legal_rules").label, hint: pickMeta("legal_rules").hint, lines: pickLines("legal_rules") },
          { key: "tone_analysis", label: pickMeta("tone_analysis").label, hint: pickMeta("tone_analysis").hint, lines: pickLines("tone_analysis") },
        ],
      },
      {
        id: "vibe_tags",
        title: "תגיות סגנון (ויב)",
        description: DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories[1].description,
        lines: pickLines("vibe_tags"),
      },
      {
        id: "responses",
        title: "איך לענות (מבנה וערוצים)",
        description: DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories[2].description,
        lines: [],
        sections: [
          "response_web",
          "channel_web",
          "response_wa",
          "response_wa_pre_cta",
          "response_wa_post_trial",
        ].map((key) => {
          const m = pickMeta(key);
          return { key, label: m.label, hint: m.hint, lines: m.lines };
        }),
      },
      {
        id: "situations",
        title: "מצבים מיוחדים",
        description: DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories[3].description,
        lines: [],
        sections: ["unknown_knowledge", "channel_whatsapp", "sales_flow_meta"].map((key) => {
          const m = pickMeta(key);
          return { key, label: m.label, hint: m.hint, lines: m.lines };
        }),
      },
    ],
  };
}

/** ממזג שמור ב-DB עם ברירת מחדל (פורמט 4 קטגוריות) */
export function mergeWithDefaultZoePlatform(stored: ZoePlatformGuidelines | null): ZoePlatformGuidelines {
  const defaults = DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES.categories;
  if (!stored?.categories?.length) return DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES;

  const display = isDisplayFormat(stored.categories)
    ? stored.categories
    : migrateLegacyCategoriesToDisplay(stored.categories).categories;

  const byId = new Map(display.map((c) => [c.id, c]));
  const merged: ZoePlatformCategory[] = defaults.map((def) => {
    const s = byId.get(def.id);
    if (!s) return def;
    if (!def.sections?.length) {
      return { ...def, ...s, lines: s.lines.length ? s.lines : def.lines };
    }
    const defSecs = def.sections ?? [];
    const sSecs = s.sections ?? [];
    const sByKey = new Map(sSecs.map((sec) => [sec.key, sec]));
    return {
      ...def,
      ...s,
      sections: defSecs.map((ds) => {
        const ov = sByKey.get(ds.key);
        return ov && ov.lines.length ? { ...ds, ...ov, lines: ov.lines } : ds;
      }),
    };
  });

  for (const c of display) {
    if (!defaults.some((d) => d.id === c.id)) merged.push(c);
  }
  return { categories: merged };
}

export function guidelinesForAdminDisplay(stored: ZoePlatformGuidelines | null): ZoePlatformGuidelines {
  if (!stored?.categories?.length) return DEFAULT_BUSINESS_ZOE_PLATFORM_GUIDELINES;
  if (isDisplayFormat(stored.categories)) return mergeWithDefaultZoePlatform(stored);
  return migrateLegacyCategoriesToDisplay(stored.categories);
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

function resolveInternalSection(
  guidelines: ZoePlatformGuidelines,
  internalKey: string
): { title: string; lines: string[] } | null {
  const direct = guidelines.categories.find((c) => c.id === internalKey);
  if (direct?.lines.length) {
    return { title: direct.title, lines: direct.lines };
  }

  for (const cat of guidelines.categories) {
    const sec = cat.sections?.find((s) => s.key === internalKey);
    if (sec) return { title: sec.label, lines: sec.lines };
  }

  return null;
}

export function getZoePlatformCategory(
  guidelines: ZoePlatformGuidelines,
  categoryId: string
): ZoePlatformCategory | undefined {
  const resolved = resolveInternalSection(guidelines, categoryId);
  if (!resolved) return undefined;
  return {
    id: categoryId,
    title: resolved.title,
    description: "",
    lines: resolved.lines,
  };
}

export function getZoePlatformCategoryBlock(guidelines: ZoePlatformGuidelines, categoryId: string): string {
  const resolved = resolveInternalSection(guidelines, categoryId);
  if (!resolved?.lines.length) return "";
  const header = `【${resolved.title}】`;
  const body = resolved.lines.map((t, i) => `${i + 1}. ${t}`).join("\n");
  return `${header}\n${body}`;
}

const INTERNAL_KEYS_SET = new Set<string>(ZOE_PLATFORM_INTERNAL_KEYS);

/** קטגוריות מותאמות אישית בלבד */
export function buildZoePlatformPromptSection(guidelines: ZoePlatformGuidelines): string {
  const blocks = guidelines.categories
    .filter((c) => !DISPLAY_CATEGORY_IDS.includes(c.id as (typeof DISPLAY_CATEGORY_IDS)[number]))
    .map((c) => {
      const parts: string[] = [];
      if (c.lines.length) {
        parts.push(...c.lines.map((t, i) => `${i + 1}. ${t}`));
      }
      for (const sec of c.sections ?? []) {
        if (INTERNAL_KEYS_SET.has(sec.key)) continue;
        parts.push(...sec.lines.map((t) => `• ${t}`));
      }
      if (!parts.length) return "";
      const desc = c.description.trim() ? ` (${c.description})` : "";
      return `### ${c.title}${desc}\n${parts.join("\n")}`;
    })
    .filter(Boolean);
  if (!blocks.length) return "";
  return `\n\nהנחיות נוספות (קטגוריות מותאמות):\n${blocks.join("\n\n")}`;
}

export function buildVibeLinesMapFromPlatform(guidelines: ZoePlatformGuidelines): Record<string, string> {
  const resolved = resolveInternalSection(guidelines, "vibe_tags");
  const map: Record<string, string> = {};
  if (!resolved) return map;
  for (const line of resolved.lines) {
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
  return { categories: parsed.slice(0, 8) };
}
