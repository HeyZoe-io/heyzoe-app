import { resolveArboxMembershipApiFullUrl, resolveArboxMembershipApiPathCandidates } from "@/lib/server-env";

const FETCH_TIMEOUT_MS = 14_000;

export type ArboxMembershipTier = {
  name: string;
  price: string;
  monthly_sessions: string;
  notes: string;
};

export type ArboxPunchCard = {
  session_count: string;
  validity: string;
  notes: string;
};

export type ArboxApiSyncResult =
  | {
      ok: true;
      membership_tiers: ArboxMembershipTier[];
      punch_cards: ArboxPunchCard[];
      source_url: string;
    }
  | { ok: false; code: string; message: string; last_status?: number };

function pickStr(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function clubOriginFromArboxLink(arboxLink: string): string | null {
  const raw = arboxLink.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function buildCandidateUrls(origin: string): string[] {
  const full = resolveArboxMembershipApiFullUrl();
  if (full) {
    if (full.includes("{origin}")) {
      return [full.replace(/\{origin\}/g, origin.replace(/\/$/, ""))];
    }
    return [full];
  }
  const paths = resolveArboxMembershipApiPathCandidates();
  const base = origin.replace(/\/$/, "");
  return paths.map((p) => `${base}${p.startsWith("/") ? p : `/${p}`}`);
}

function looksLikeHtml(body: string): boolean {
  const t = body.slice(0, 200).toLowerCase();
  return t.includes("<!doctype") || t.includes("<html");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

type AuthMode =
  | { type: "header"; headers: Record<string, string> }
  | { type: "query"; param: string };

const AUTH_MODES: AuthMode[] = [
  { type: "header", headers: { Authorization: "" } }, // filled per request
  { type: "header", headers: { "X-Api-Key": "" } },
  { type: "header", headers: { "x-api-key": "" } },
  { type: "header", headers: { "X-Arbox-Api-Key": "" } },
  { type: "query", param: "api_key" },
  { type: "query", param: "token" },
];

function extractItemsFromJson(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    return json.filter((x): x is Record<string, unknown> => x !== null && typeof x === "object") as Record<
      string,
      unknown
    >[];
  }
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of [
      "data",
      "plans",
      "membership_plans",
      "memberships",
      "items",
      "results",
      "rows",
      "records",
    ]) {
      const v = o[k];
      const inner = extractItemsFromJson(v);
      if (inner.length) return inner;
    }
  }
  return [];
}

function itemToTier(o: Record<string, unknown>): ArboxMembershipTier {
  return {
    name: pickStr(o, ["name", "title", "plan_name", "label", "membership_name", "product_name"]),
    price: pickStr(o, [
      "price",
      "price_text",
      "monthly_price",
      "amount",
      "formatted_price",
      "priceFormatted",
      "display_price",
    ]),
    monthly_sessions: pickStr(o, [
      "monthly_sessions",
      "sessions_per_month",
      "classes_per_month",
      "entries_per_month",
      "sessionsPerMonth",
    ]),
    notes: pickStr(o, ["notes", "description", "details", "subtitle"]),
  };
}

function itemToCard(o: Record<string, unknown>): ArboxPunchCard {
  return {
    session_count: pickStr(o, [
      "session_count",
      "sessions",
      "entries",
      "credits",
      "uses",
      "number_of_sessions",
    ]),
    validity: pickStr(o, ["validity", "duration", "expiry", "expires_in", "valid_for"]),
    notes: pickStr(o, ["notes", "description", "name", "title", "plan_name"]),
  };
}

function classifyAndMap(items: Record<string, unknown>[]): {
  membership_tiers: ArboxMembershipTier[];
  punch_cards: ArboxPunchCard[];
} {
  const membership_tiers: ArboxMembershipTier[] = [];
  const punch_cards: ArboxPunchCard[] = [];

  for (const o of items) {
    const typeHint = `${pickStr(o, ["type", "plan_type", "category", "kind"])}`.toLowerCase();
    const billing = `${o.billing_cycle ?? o.billing ?? o.interval ?? ""}`.toLowerCase();
    const hasMonthly =
      /month|חודש|recurring|subscription/.test(billing) ||
      Boolean(o.monthly_price || o.price_per_month || o.is_monthly === true);
    const card = itemToCard(o);
    const tier = itemToTier(o);

    const looksPunch =
      /punch|pack|session\s*pack|כרטיס|חביל|multi|מנוי\s*כניסות/.test(typeHint) ||
      (Boolean(card.session_count) && !hasMonthly && !tier.price);

    if (looksPunch && (card.session_count || card.validity || card.notes)) {
      punch_cards.push(card);
    } else if (tier.name || tier.price || tier.monthly_sessions || tier.notes) {
      membership_tiers.push(tier);
    } else if (card.session_count || card.validity) {
      punch_cards.push(card);
    }
  }

  return {
    membership_tiers: membership_tiers.slice(0, 24),
    punch_cards: punch_cards.slice(0, 24),
  };
}

async function tryOneUrl(url: string, apiKey: string): Promise<ArboxApiSyncResult | null> {
  for (const mode of AUTH_MODES) {
    let finalUrl = url;
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (mode.type === "header") {
      const h = { ...mode.headers };
      const [hk] = Object.keys(h);
      if (hk === "Authorization") {
        h.Authorization = `Bearer ${apiKey}`;
      } else {
        (h as Record<string, string>)[hk] = apiKey;
      }
      Object.assign(headers, h);
    } else {
      try {
        const u = new URL(url);
        u.searchParams.set(mode.param, apiKey);
        finalUrl = u.toString();
      } catch {
        continue;
      }
    }

    let res: Response;
    try {
      res = await fetchWithTimeout(finalUrl, { method: "GET", headers });
    } catch {
      continue;
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        continue;
      }
      if (!looksLikeHtml(text) && text.trim().startsWith("{")) {
        try {
          JSON.parse(text);
        } catch {
          /* ignore */
        }
      }
      continue;
    }

    if (looksLikeHtml(text)) {
      continue;
    }

    let json: unknown;
    if (ct.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        continue;
      }
    } else {
      continue;
    }

    const items = extractItemsFromJson(json);
    if (!items.length) {
      continue;
    }

    const { membership_tiers, punch_cards } = classifyAndMap(items);
    if (!membership_tiers.length && !punch_cards.length) {
      continue;
    }

    return { ok: true, membership_tiers, punch_cards, source_url: finalUrl };
  }

  return null;
}

/** משיכת מנויים/כרטיסיות מ-API ארבוקס (מפתח מהמועדון + מקור מקישור השעות). */
export async function syncArboxMembershipsFromApi(arboxLink: string, apiKey: string): Promise<ArboxApiSyncResult> {
  const key = apiKey.trim();
  if (!key) {
    return { ok: false, code: "missing_api_key", message: "חסר מפתח API ארבוקס — הזינו אותו בהגדרות (הגדרות → אינטגרציות)." };
  }

  const origin = clubOriginFromArboxLink(arboxLink);
  if (!origin) {
    return {
      ok: false,
      code: "missing_arbox_link",
      message: "חסר קישור מערכת שעות ארבוקס — נדרש לזיהוי המועדון (מקור ה-API).",
    };
  }

  const urls = buildCandidateUrls(origin);

  for (const url of urls) {
    const attempt = await tryOneUrl(url, key);
    if (attempt?.ok) {
      return attempt;
    }
  }

  return {
    ok: false,
    code: "api_no_match",
    message:
      "לא נמצאה תשובת JSON תקפה מארבוקס. ודאו שהמפתח מוגדר ב-הגדרות → אינטגרציות בארבוקס, שהקישור לשעות נכון, והגדירו בשרת את משתנה הסביבה ARBOX_MEMBERSHIP_API_URL (או ARBOX_MEMBERSHIP_API_PATHS) לפי התיעוד שקיבלתם מארבוקס.",
  };
}
