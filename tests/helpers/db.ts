import { PGlite, type Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), "utf8");

/**
 * A brand-new in-memory Postgres with the Supabase stub, every migration in
 * supabase/migrations (in order) and supabase/seed.sql applied, exactly as
 * `supabase db reset` would.
 */
export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(read("tests", "sql", "supabase-shim.sql"));

  const migrationsDir = join(repoRoot, "supabase", "migrations");
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of migrations) {
    await db.exec(read("supabase", "migrations", file));
  }

  await db.exec(read("supabase", "seed.sql"));
  return db;
}

/**
 * Run `fn` the way a logged-in website/bot user's API request runs: as the
 * `authenticated` role, with auth.uid() = authUserId, so row-level security applies.
 * Everything happens in one transaction; if `fn` throws, it is rolled back.
 */
export async function asUser<T>(
  db: PGlite,
  authUserId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [authUserId]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

export interface TestMember {
  id: string;
  authUserId: string;
}

/** Create an active, RSI-verified member (as the database owner, bypassing RLS). */
export async function addMember(
  db: PGlite,
  opts: { name: string; rank: string; admin?: boolean },
): Promise<TestMember> {
  const authUserId = randomUUID();
  await db.query("insert into auth.users (id) values ($1)", [authUserId]);

  const { rows } = await db.query<{ id: string }>(
    `insert into public.members
       (auth_user_id, discord_id, discord_name, status, rsi_verified_at, rank_id, joined_at)
     values ($1, $2, $3, 'active', now(), (select id from public.ranks where name = $4), now())
     returning id`,
    [authUserId, `discord-${opts.name}`, opts.name, opts.rank],
  );
  const id = rows[0]!.id;

  if (opts.admin) {
    // An org-wide appointment is what makes someone an Admin (=The High Table=).
    await db.query(
      `insert into public.appointments (member_id, title, scope, scope_id)
       values ($1, 'Administration (=The High Table=)', 'org', null)`,
      [id],
    );
  }

  return { id, authUserId };
}

export async function rankId(db: PGlite, name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>("select id from public.ranks where name = $1", [name]);
  if (!rows[0]) throw new Error(`No rank named ${name} in the seed`);
  return rows[0].id;
}

/** A member's current rank name, read as the database owner. */
export async function rankNameOf(db: PGlite, memberId: string): Promise<string | null> {
  const { rows } = await db.query<{ name: string | null }>(
    "select r.name from public.members m left join public.ranks r on r.id = m.rank_id where m.id = $1",
    [memberId],
  );
  return rows[0]?.name ?? null;
}
