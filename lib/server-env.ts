/**
 * משתני סביבה בצד שרת — סדר עדיפות (הראשון שנמצא מנצח):
 *
 * Claude:
 *   1. ANTHROPIC_API_KEY
 *
 * Supabase URL:
 *   1. NEXT_PUBLIC_SUPABASE_URL
 *   2. SUPABASE_URL
 *
 * Supabase anon (לקוח ציבורי / PostgREST):
 *   1. NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   2. SUPABASE_ANON_KEY
 *
 * Supabase service role — רק לשרת, לעולם לא ל-Client; לא נדרש ל-bootstrap של /api/business.
 */

export function resolveClaudeApiKey(): string {
  return process.env.ANTHROPIC_API_KEY?.trim() ?? "";
}

export function resolveSupabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    ""
  );
}

export function resolveSupabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    ""
  );
}

/** מפתח service role — לשימוש בצד שרת בלבד (לא חובה לנתיבי ה-API הנוכחיים). */
export function resolveSupabaseServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
}

/** אם מוגדר — נתיבי cron (למשל /api/cron/followup) דורשים `Authorization: Bearer …`. */
export function resolveCronSecret(): string {
  return process.env.CRON_SECRET?.trim() ?? "";
}

/** דלי Storage להעלאות (לוגו, מדיה לפתיחה) — חייב להתקיים ב-Supabase או להיווצר אוטומטית */
export function resolveSupabaseStorageBucket(): string {
  return (
    process.env.SUPABASE_STORAGE_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim() ||
    "business-assets"
  );
}

export function resolveAdminAllowedEmail(): string {
  return process.env.ADMIN_ALLOWED_EMAIL?.trim().toLowerCase() || "liornativ@hotmail.com";
}

/**
 * Arbox — Public API (מומלץ, מפתח per-business ב-social_links):
 *   ARBOX_PUBLIC_API_BASE — ברירת מחדל https://arboxserver.arboxapp.com/api/public
 *   ARBOX_SCHEDULE_FROM_PARAM / ARBOX_SCHEDULE_TO_PARAM — שמות query ל-/v3/schedule (ברירת מחדל from_date, to_date)
 *   ARBOX_SEARCH_USER_PHONE_PARAMS — רשימה מופרדת בפסיק של שמות פרמטרים לנסות ב-/v3/users/searchUser
 *   ARBOX_LEADS_CONVERTED_PHONE_PARAM — פרמטר טלפון ל-/v3/leads/converted (ברירת מחדל phone)
 *   ARBOX_TRIAL_PHONE_PARAM — פרמטר טלפון ל-/v3/schedule/booking/trial (ברירת מחדל phone)
 *   ARBOX_LEAD_POST_BODY_TEMPLATE — JSON עם placeholders {phone}, {fullName}, {source} ל-POST /v3/leads
 *   ARBOX_SCHEDULE_REGISTRATION_COUNT_PARAM — שם query ל-/v3/schedule עם קטגוריה (ברירת מחדל Registration_count)
 *
 * Arbox — משיכת מנויים legacy (מקור מקישור מועדון):
 *   ARBOX_MEMBERSHIP_API_URL — URL מלא ל-GET; אפשר `{origin}` שמוחלף במקור מקישור השעות.
 *   ARBOX_MEMBERSHIP_API_PATHS — נתיבים יחסיים מופרדים בפסיק, אם לא הוגדר URL מלא.
 */
export function resolveArboxPublicApiBase(): string {
  return (
    process.env.ARBOX_PUBLIC_API_BASE?.trim() || "https://arboxserver.arboxapp.com/api/public"
  );
}

export function resolveArboxScheduleQueryKeys(): { fromKey: string; toKey: string } {
  return {
    fromKey: process.env.ARBOX_SCHEDULE_FROM_PARAM?.trim() || "from_date",
    toKey: process.env.ARBOX_SCHEDULE_TO_PARAM?.trim() || "to_date",
  };
}

export function resolveArboxMembershipApiFullUrl(): string {
  return process.env.ARBOX_MEMBERSHIP_API_URL?.trim() ?? "";
}

export function resolveArboxMembershipApiPathCandidates(): string[] {
  const raw = process.env.ARBOX_MEMBERSHIP_API_PATHS?.trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [
    "/api/v1/membership-plans",
    "/api/v1/memberships",
    "/api/v1/plans",
    "/api/v1/subscription-plans",
    "/api/v1/products",
    "/api/external/v1/membership-plans",
  ];
}

export function listMissingBusinessBootstrapKeys(): string[] {
  const missing: string[] = [];
  if (!resolveClaudeApiKey()) {
    missing.push("ANTHROPIC_API_KEY");
  }
  if (!resolveSupabaseUrl()) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL (או SUPABASE_URL)");
  }
  if (!resolveSupabaseAnonKey()) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY (או SUPABASE_ANON_KEY)");
  }
  return missing;
}
