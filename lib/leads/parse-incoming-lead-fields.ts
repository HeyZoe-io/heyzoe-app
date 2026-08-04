/**
 * Map Elementor / Zapier / form webhook bodies to { fullName, phone }.
 * Keys are matched case-insensitively (and after stripping spaces/_/-).
 */

const NAME_KEYS = new Set([
  "full_name",
  "fullname",
  "fullname",
  "שםמלא",
  "yourname",
  "your_name",
  "firstname",
  "first_name",
  "שםפרטי",
]);

const PHONE_KEYS = new Set([
  "phone",
  "tel",
  "mobile",
  "whatsapp",
  "cellphone",
  "cell",
  "טלפון",
  "פלאפון",
  "נייד",
  "phone_number",
  "phonenumber",
  "your_phone",
  "yourphone",
]);

function normalizeKey(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function asScalarString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object" && value !== null && "value" in value) {
    return asScalarString((value as { value: unknown }).value);
  }
  return "";
}

/** Flatten one level of nested objects (Elementor sometimes nests under fields). */
function flattenBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  for (const nestKey of ["fields", "form_fields", "data"]) {
    const nested = body[nestKey];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      Object.assign(out, nested as Record<string, unknown>);
    }
  }
  return out;
}

export type ParsedIncomingLeadFields = {
  fullName: string;
  phoneRaw: string;
  businessSlug: string;
};

/**
 * Extract name/phone/slug from a webhook JSON or form-urlencoded object.
 * Tolerant of Elementor Custom IDs and Hebrew field labels-as-keys.
 */
export function parseIncomingLeadFields(body: Record<string, unknown>): ParsedIncomingLeadFields {
  const flat = flattenBody(body);

  let fullName = "";
  let phoneRaw = "";
  const businessSlug = asScalarString(flat.business_slug || flat.businessSlug);

  for (const [key, value] of Object.entries(flat)) {
    const norm = normalizeKey(key);
    const text = asScalarString(value);
    if (!text) continue;

    if (!fullName && (NAME_KEYS.has(norm) || NAME_KEYS.has(key.trim().toLowerCase()))) {
      fullName = text;
      continue;
    }
    if (!phoneRaw && (PHONE_KEYS.has(norm) || PHONE_KEYS.has(key.trim().toLowerCase()))) {
      phoneRaw = text;
      continue;
    }
  }

  // Hebrew label keys that normalizeKey already covers via NAME_KEYS/PHONE_KEYS.
  // Fallback: exact known aliases left as-is in body.
  if (!fullName) {
    fullName = asScalarString(flat.full_name || flat.name || flat["שם"] || flat["שם מלא"]);
  }
  if (!phoneRaw) {
    phoneRaw = asScalarString(
      flat.phone || flat.tel || flat.mobile || flat.whatsapp || flat["טלפון"] || flat["פלאפון"]
    );
  }

  return { fullName, phoneRaw, businessSlug: businessSlug.toLowerCase() };
}

/** Parse raw request text as JSON object or URL-encoded form fields. */
export function parseIncomingLeadBodyText(
  rawText: string,
  contentType: string | null
): Record<string, unknown> | null {
  const text = String(rawText ?? "").trim();
  if (!text) return {};

  const ct = String(contentType ?? "").toLowerCase();
  const looksJson =
    ct.includes("application/json") || text.startsWith("{") || text.startsWith("[");

  if (looksJson) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      // fall through to form parse
    }
  }

  if (ct.includes("application/x-www-form-urlencoded") || text.includes("=")) {
    const params = new URLSearchParams(text);
    const out: Record<string, unknown> = {};
    for (const [k, v] of params.entries()) {
      out[k] = v;
    }
    return out;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}
