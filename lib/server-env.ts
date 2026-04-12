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
 * Arbox — משיכת מנויים מ-API (דשבורד):
 *   ARBOX_MEMBERSHIP_API_URL — URL מלא ל-GET; אפשר `{origin}` שמוחלף במקור מקישור השעות (למשל https://club.web.arboxapp.com).
 *   ARBOX_MEMBERSHIP_API_PATHS — נתיבים יחסיים מופרדים בפסיק, אם לא הוגדר URL מלא.
 */
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
