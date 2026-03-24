import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  resolveSupabaseAnonKey,
  resolveSupabaseUrl,
} from "@/lib/server-env";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
