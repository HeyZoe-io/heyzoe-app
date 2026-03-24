import { createClient } from "@supabase/supabase-js";
import {
  resolveSupabaseServiceRoleKey,
  resolveSupabaseUrl,
} from "@/lib/server-env";

export function createSupabaseAdminClient() {
  const url = resolveSupabaseUrl();
  const serviceRole = resolveSupabaseServiceRoleKey();

  if (!url || !serviceRole) {
    throw new Error("missing_supabase_admin_env");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
