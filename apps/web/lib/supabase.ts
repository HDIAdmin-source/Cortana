import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** A Supabase client with the public (anon) key, or null if .env.local isn't set up yet. */
export function publicClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
