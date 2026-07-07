/**
 * Shared test-phone guard for scripts that send WhatsApp / webhook messages.
 * Production webhook code must never import this file.
 */

export const WARMUP_TEST_PHONE_DEFAULT = "972508318162";

/** Production Supabase host — warmup scripts refuse this unless ALLOW_PROD_TEST=1. */
export const PRODUCTION_SUPABASE_HOST_DEFAULT = "ltbxmbqfenxkrwuoezou.supabase.co";

/** Env vars that must not override the fixed test phone when set to a different number. */
const ALTERNATE_PHONE_ENV_KEYS = ["RECIPIENT_PHONE", "TEST_PHONE", "TO_PHONE", "WA_TEST_PHONE"];

/**
 * Normalize Israeli mobile to digits-only 972… form (no +).
 */
export function normalizeWarmupTestPhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0") && digits.length >= 9) return `972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith("5")) return `972${digits}`;
  return digits;
}

/** Single source of truth: WARMUP_TEST_PHONE env or default. */
export function resolveWarmupTestPhone() {
  const fromEnv = process.env.WARMUP_TEST_PHONE?.trim();
  const phone = normalizeWarmupTestPhone(fromEnv || WARMUP_TEST_PHONE_DEFAULT);
  if (!phone) {
    console.error("[warmup-test-config] WARMUP_TEST_PHONE is empty after normalization.");
    process.exit(1);
  }
  return phone;
}

/**
 * Double guard: refuse if `phone` !== resolved test phone.
 * Call once at startup and again immediately before outbound sends when useful.
 */
export function assertWarmupTestPhone(phone, context = "script") {
  const expected = resolveWarmupTestPhone();
  const actual = normalizeWarmupTestPhone(phone);
  if (!actual) {
    console.error(`[warmup-test-config] ${context}: missing phone — refused.`);
    process.exit(1);
  }
  if (actual !== expected) {
    console.error(
      `[warmup-test-config] ${context}: refused — phone ${actual} is not the fixed test phone ${expected}.`,
      "Use WARMUP_TEST_PHONE only; do not pass another recipient."
    );
    process.exit(1);
  }
  return actual;
}

/** Fail if legacy env vars point at a different number (prevents accidental override). */
export function rejectAlternatePhoneEnvVars(context = "script") {
  const expected = resolveWarmupTestPhone();
  for (const key of ALTERNATE_PHONE_ENV_KEYS) {
    const raw = process.env[key]?.trim();
    if (!raw) continue;
    const normalized = normalizeWarmupTestPhone(raw);
    if (normalized && normalized !== expected) {
      console.error(
        `[warmup-test-config] ${context}: refused — ${key}=${raw} differs from WARMUP_TEST_PHONE (${expected}).`,
        `Unset ${key} or set it to the test phone only.`
      );
      process.exit(1);
    }
  }
}

function resolveProductionSupabaseHost() {
  return (
    process.env.HEYZOE_PRODUCTION_SUPABASE_HOST ??
    process.env.PRODUCTION_SUPABASE_HOST ??
    PRODUCTION_SUPABASE_HOST_DEFAULT
  )
    .trim()
    .toLowerCase();
}

/**
 * Refuse warmup runs against production by default.
 * - NEXT_PUBLIC_SUPABASE_URL → production host
 * - HTTP base (LOCAL_BASE / PREVIEW_BASE / computed BASE) contains heyzoe.io
 * Override only with explicit ALLOW_PROD_TEST=1.
 */
export function assertWarmupTestEnvironmentSafe(context = "script", opts = {}) {
  if (process.env.ALLOW_PROD_TEST === "1") {
    console.warn(
      `[warmup-test-config] ${context}: ALLOW_PROD_TEST=1 — production target allowed (real WA/DB possible).`
    );
    return;
  }

  const prodSupabaseHost = resolveProductionSupabaseHost();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (supabaseUrl) {
    let host = "";
    try {
      host = new URL(supabaseUrl).hostname.toLowerCase();
    } catch {
      console.error(`[warmup-test-config] ${context}: invalid NEXT_PUBLIC_SUPABASE_URL — refused.`);
      process.exit(1);
    }
    if (host === prodSupabaseHost) {
      console.error(
        `[warmup-test-config] ${context}: refused — NEXT_PUBLIC_SUPABASE_URL is production (${host}).`,
        "Use a dev/staging env file, or set ALLOW_PROD_TEST=1 explicitly (sends real WhatsApp)."
      );
      process.exit(1);
    }
  }

  const httpCandidates = [opts.httpBase, process.env.PREVIEW_BASE, process.env.LOCAL_BASE].filter(Boolean);
  for (const raw of httpCandidates) {
    const lower = String(raw).trim().toLowerCase();
    if (lower.includes("heyzoe.io")) {
      console.error(
        `[warmup-test-config] ${context}: refused — HTTP target contains heyzoe.io (${raw}).`,
        "Use localhost/preview only, or set ALLOW_PROD_TEST=1 explicitly."
      );
      process.exit(1);
    }
  }
}

/** --slug foo or --slug=foo; fallback WARMUP_TEST_SLUG; default info-2815. */
export function resolveWarmupTestSlug(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--slug" && argv[i + 1]) {
      return String(argv[i + 1]).trim().toLowerCase();
    }
    if (arg.startsWith("--slug=")) {
      return arg.slice("--slug=".length).trim().toLowerCase();
    }
  }
  return (process.env.WARMUP_TEST_SLUG ?? "info-2815").trim().toLowerCase();
}

/** Lookup business + active Meta phone_number_id for webhook simulation. */
export async function resolveBusinessFromSlug(slugInput) {
  const slug = String(slugInput ?? "").trim().toLowerCase();
  if (!slug) {
    console.error("[warmup-test-config] resolveBusinessFromSlug: empty slug.");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("[warmup-test-config] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key);

  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (bizErr) {
    console.error("[warmup-test-config] businesses query failed:", bizErr.message);
    process.exit(1);
  }
  if (!biz?.id) {
    console.error(`[warmup-test-config] Business not found for slug: ${slug}`);
    process.exit(1);
  }

  const { data: channel, error: chErr } = await admin
    .from("whatsapp_channels")
    .select("phone_number_id, business_slug, is_active")
    .eq("business_id", biz.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (chErr) {
    console.error("[warmup-test-config] whatsapp_channels query failed:", chErr.message);
    process.exit(1);
  }
  const phoneNumberId = String(channel?.phone_number_id ?? "").trim();
  if (!phoneNumberId) {
    console.error(`[warmup-test-config] No active WhatsApp channel for slug: ${slug}`);
    process.exit(1);
  }

  return {
    businessId: Number(biz.id),
    slug: String(biz.slug ?? slug).trim().toLowerCase(),
    phoneNumberId,
  };
}

/** Startup bundle for outbound scripts: fixed phone + no alternate env overrides. */
export function enforceWarmupTestPhoneOnly(context = "script") {
  rejectAlternatePhoneEnvVars(context);
  const phone = resolveWarmupTestPhone();
  assertWarmupTestPhone(phone, context);
  return phone;
}

/** Phone guard + production environment guard (call before any webhook/WA side effects). */
export function enforceWarmupTestSafe(context = "script", envOpts = {}) {
  const phone = enforceWarmupTestPhoneOnly(context);
  assertWarmupTestEnvironmentSafe(context, envOpts);
  return phone;
}
