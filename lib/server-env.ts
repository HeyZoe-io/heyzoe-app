/**
 * משתני סביבה בצד שרת — סדר עדיפות (הראשון שנמצא מנצח):
 *
 * Gemini:
 *   1. GEMINI_API_KEY
 *   2. GOOGLE_GENERATIVE_AI_API_KEY
 *   3. GOOGLE_API_KEY
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

export function resolveGeminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    ""
  );
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

export function resolveAdminAllowedEmail(): string {
  return process.env.ADMIN_ALLOWED_EMAIL?.trim().toLowerCase() || "liornativ@hotmail.com";
}

export function listMissingBusinessBootstrapKeys(): string[] {
  const missing: string[] = [];
  if (!resolveGeminiApiKey()) {
    missing.push("GEMINI_API_KEY (או GOOGLE_GENERATIVE_AI_API_KEY)");
  }
  if (!resolveSupabaseUrl()) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL (או SUPABASE_URL)");
  }
  if (!resolveSupabaseAnonKey()) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY (או SUPABASE_ANON_KEY)");
  }
  return missing;
}
