import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  resolveSupabaseServiceRoleKey,
  resolveSupabaseUrl,
} from "@/lib/server-env";

type GlobalAdmin = { __hzSupabaseAdmin?: SupabaseClient };

/**
 * Reuse one service-role client per isolate. `createClient` is synchronous CPU
 * (headers, fetch wrapper, schema init) and used on almost every API/cron/webhook.
 */
export function createSupabaseAdminClient() {
  const g = globalThis as unknown as GlobalAdmin;
  if (g.__hzSupabaseAdmin) return g.__hzSupabaseAdmin;

  const url = resolveSupabaseUrl();
  const serviceRole = resolveSupabaseServiceRoleKey();

  if (!url || !serviceRole) {
    throw new Error("missing_supabase_admin_env");
  }

  g.__hzSupabaseAdmin = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return g.__hzSupabaseAdmin;
}
