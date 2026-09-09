import { getWaMessageLogScope } from "@/lib/wa-message-log-context";

/** Studios that must not send 💜 in customer-facing WhatsApp copy. */
const STRIP_PURPLE_HEART_SLUGS = new Set(["apex"]);

/** Apex Meta Cloud phone_number_id + E.164 digits (Twilio / display). */
const STRIP_PURPLE_HEART_FROM_NUMBERS = new Set([
  "1059985637203946",
  "972502303044",
]);

export type StudioPurpleHeartCtx = {
  slug?: string | null;
  fromNumber?: string | null;
};

export function stripPurpleHearts(text: string): string {
  let s = String(text ?? "").replace(/\u{1F49C}\uFE0F?/gu, "");
  s = s.replace(/[^\S\n]{2,}/g, " ");
  s = s.replace(/[^\S\n]+\n/g, "\n");
  s = s.replace(/\n[^\S\n]+/g, "\n");
  s = s.replace(/[^\S\n]+$/gm, "");
  return s.trim();
}

function fromNumberDigits(fromNumber: string): string {
  return String(fromNumber ?? "").replace(/\D/g, "");
}

export function shouldStripPurpleHearts(ctx?: StudioPurpleHeartCtx): boolean {
  const slug = String(ctx?.slug ?? getWaMessageLogScope()?.businessSlug ?? "")
    .trim()
    .toLowerCase();
  if (slug && STRIP_PURPLE_HEART_SLUGS.has(slug)) return true;
  const digits = fromNumberDigits(String(ctx?.fromNumber ?? "").trim());
  return Boolean(digits) && STRIP_PURPLE_HEART_FROM_NUMBERS.has(digits);
}

export function applyStudioPurpleHeartPolicy(text: string, ctx?: StudioPurpleHeartCtx): string {
  const raw = String(text ?? "");
  if (!shouldStripPurpleHearts(ctx)) return raw;
  return stripPurpleHearts(raw);
}

export function applyStudioPurpleHeartPolicyDeep<T>(value: T, ctx?: StudioPurpleHeartCtx): T {
  if (!shouldStripPurpleHearts(ctx)) return value;
  return stripPurpleHeartsDeep(value);
}

function stripPurpleHeartsDeep<T>(value: T): T {
  if (typeof value === "string") return stripPurpleHearts(value) as T;
  if (Array.isArray(value)) return value.map((item) => stripPurpleHeartsDeep(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripPurpleHeartsDeep(v);
    }
    return out as T;
  }
  return value;
}
