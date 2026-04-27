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

export function resolveAdminAllowedEmails(): string[] {
  const single = resolveAdminAllowedEmail();
  const rawList =
    process.env.ADMIN_ALLOWED_EMAILS?.trim() ||
    process.env.ADMIN_ALLOWED_EMAIL_LIST?.trim() ||
    "";
  const fromList = rawList
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // Always include the single env + liornativ@hotmail.com for safety.
  return Array.from(new Set([single, "liornativ@hotmail.com", ...fromList]));
}

export function isAdminAllowedEmail(email: string): boolean {
  const clean = String(email ?? "").trim().toLowerCase();
  if (!clean) return false;
  return resolveAdminAllowedEmails().includes(clean);
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
