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

/**
 * Call a bot_* database function the way the Discord bot does: as the service role.
 * Returns the function's result (jsonb comes back as a plain object).
 */
export async function botCall<T = unknown>(db: PGlite, fn: string, ...args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    const { rows } = await tx.query<{ result: T }>(`select public.${fn}(${placeholders}) as result`, args);
    return rows[0]!.result;
  });
}

export interface PersonOptions {
  discordId: string;
  name: string;
  rank?: string | null;
  status?: "applicant" | "active" | "inactive" | "departed";
  verified?: boolean;
  /** Home initiative slug and optional division slug. */
  home?: { initiative: string; division?: string };
  /** A current appointment over an initiative or division (by slug), or org-wide. */
  appointment?: { title: string; scope: "org" } | { title: string; scope: "initiative"; initiative: string } | {
    title: string;
    scope: "division";
    initiative: string;
    division: string;
  };
}

/** Create a member identified by Discord ID (as the database owner, bypassing RLS). */
export async function addPerson(db: PGlite, p: PersonOptions): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.members (discord_id, discord_name, status, rsi_handle, rsi_verified_at, rank_id, joined_at)
     values ($1, $2, $3, $4, case when $5 then now() end, (select id from public.ranks where name = $6), now())
     returning id`,
    [p.discordId, p.name, p.status ?? "active", `rsi_${p.discordId}`, p.verified ?? true, p.rank ?? null],
  );
  const id = rows[0]!.id;

  if (p.home) {
    await db.query(
      `insert into public.member_assignments (member_id, initiative_id, division_id, is_primary)
       select $1, i.id, d.id, true
       from public.initiatives i
       left join public.divisions d on d.initiative_id = i.id and d.slug = $3
       where i.slug = $2`,
      [id, p.home.initiative, p.home.division ?? null],
    );
  }

  if (p.appointment) {
    const a = p.appointment;
    await db.query(
      `insert into public.appointments (member_id, title, scope, scope_id)
       values ($1, $2, $3::public.appointment_scope,
         case $3
           when 'initiative' then (select id from public.initiatives where slug = $4)
           when 'division' then (select d.id from public.divisions d join public.initiatives i on i.id = d.initiative_id
                                  where i.slug = $4 and d.slug = $5)
         end)`,
      [id, a.title, a.scope, "initiative" in a ? a.initiative : null, "division" in a ? a.division : null],
    );
  }
  return id;
}

/** A member's current rank name by Discord ID. */
export async function rankOfDiscord(db: PGlite, discordId: string): Promise<string | null> {
  const { rows } = await db.query<{ name: string | null }>(
    "select r.name from public.members m left join public.ranks r on r.id = m.rank_id where m.discord_id = $1",
    [discordId],
  );
  return rows[0]?.name ?? null;
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
