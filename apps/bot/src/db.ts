import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** A message from a database rule that is safe and useful to show the person who ran the command. */
export class UserFacingError extends Error {}

export type Db = SupabaseClient;

export function createDb(url: string, serviceRoleKey: string): Db {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Call a bot_* database function. Messages raised by the rules in the database
 * (Postgres codes P0001 and 42501) become UserFacingError; anything else is a real fault.
 */
export async function rpc<T>(db: Db, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (error.code === "P0001" || error.code === "42501") {
      throw new UserFacingError(error.message);
    }
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return data as T;
}
