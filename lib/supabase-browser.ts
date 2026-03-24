"use client";

import { createBrowserClient } from "@supabase/ssr";
import {
  resolveSupabaseAnonKey,
  resolveSupabaseUrl,
} from "@/lib/server-env";

export function createSupabaseBrowserClient() {
  const url = resolveSupabaseUrl();
  const anon = resolveSupabaseAnonKey();
  return createBrowserClient(url, anon);
}
