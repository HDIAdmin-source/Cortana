# HDI Cortana

Cortana is the single backend for Hyperion Defense Industries. It holds one database plus a set of rules, and the website, the Discord bot, the phone app and (later) the game overlay all read from it and write to it. The full plan is in [docs/SPEC.md](docs/SPEC.md).

This is **Phase 1: foundation**. It includes:

- the project layout (one repository holding the website, the bot and shared code)
- the database tables
- the permission rules that decide who can change what
- the starting org data (initiatives, divisions, units and ranks)
- tests proving that an ordinary Member cannot change ranks and an Admin can

## What's in here

| Folder | What it is |
| --- | --- |
| `apps/web` | The website (Next.js). For now it is one page that lists the initiatives from the database. |
| `apps/bot` | The Discord bot (discord.js). For now it logs in and checks it can reach the database. |
| `packages/shared` | Code both apps use, such as the shapes of database rows. |
| `supabase/migrations` | The database setup, run in order: tables, then permissions, then rank-change and audit rules. |
| `supabase/seed.sql` | The starting data: 4 initiatives, 12 divisions, 10 units (8 Fleet squadrons, N.O.V.A. and H.E.R.D.), the 8-rank ladder, and the confirmed leaders (the three Chairs and Wolffe as Org Chairman). |
| `tests` | Automated checks of the permission rules. |
| `docs/SPEC.md` | The spec. If the code and the spec disagree, the spec wins. |

## One-time setup on your PC

You need three free programs. Install each one, then **close and reopen your terminal** so it can find them.

1. **Node.js** (runs JavaScript and TypeScript). Download the "LTS" version from [nodejs.org](https://nodejs.org) and install it with the default options.
2. **pnpm** (installs the project's building blocks). In a terminal, run:

   ```bash
   npm install -g pnpm
   ```

3. **Git** (version control, needed to get the code from GitHub). Download it from [git-scm.com](https://git-scm.com).

Check they all work. Each of these should print a version number:

```bash
node --version
```

```bash
pnpm --version
```

**Keep the project in a short folder path**, such as `C:\Users\<you>\code\cortana`. Windows can't start programs whose full path is longer than 260 characters, and a deeply nested folder pushes some of the project's tools past that limit. When that happens, you get a "spawn … ENOENT" error even though the file exists.

Then move your terminal into the project folder. Every `pnpm` command in this README must be run from there, not from your home folder:

```bash
cd C:\Users\<you>\code\cortana
```

Download everything the project depends on:

```bash
pnpm install
```

pnpm only lets a package run its own setup scripts if the project approves it. That approval list is `allowBuilds` in `pnpm-workspace.yaml`, and `esbuild`, which the tests need, is already on it. If a future install says "Ignored build scripts", run `pnpm approve-builds` and approve only packages you recognise.

## Run the tests (no database or Docker needed)

```bash
pnpm test
```

The tests start a temporary database in memory, apply every migration and the seed file, then act as different people:

- **A Member** tries to promote themselves, change someone else's rank, use the rank-change function, rename the ranks and forge rank history. Every attempt must fail. The test also checks that the same Member can still edit their own timezone.
- **An Admin** changes a rank. It must work, and it must leave a `rank_history` row (old rank, new rank, reason, who approved it) and an `audit_log` entry.
- **An Admin whose appointment has ended** is treated as an ordinary member again.

A green "passed" line means the database itself enforces the rules, so going around the website or bot doesn't get around them.

## Run the whole thing locally (optional)

To see the website and bot working against a real local copy of Supabase, you also need **Docker Desktop** ([docker.com](https://www.docker.com/products/docker-desktop/)). Supabase runs its local database inside Docker. Start Docker Desktop first, then:

1. **Start the local database.** The first run downloads a lot and takes a few minutes.

   ```bash
   pnpm db:start
   ```

   When it finishes it prints an **API URL**, an **anon key** and a **service_role key**. Keep that window open.

2. **Load the tables and seed data.** This also wipes the local database, which is safe because it's only your local copy.

   ```bash
   pnpm db:reset
   ```

   You can browse the data in Supabase Studio at http://127.0.0.1:54323. It works like a spreadsheet.

3. **Website.** Copy `apps/web/.env.example` to `apps/web/.env.local`. Paste in the API URL and the anon key, then run:

   ```bash
   pnpm dev:web
   ```

   Open http://localhost:3000. You should see Helios, Eos, Selene and Auxiliary with their mottos.

4. **Bot** (use your **test** Discord server, never the live one). Copy `apps/bot/.env.example` to `apps/bot/.env`. Fill in the bot token from the Discord Developer Portal, plus the API URL and service_role key from step 1. Then run:

   ```bash
   pnpm dev:bot
   ```

   It should print "logged in as …" and "Database OK. Initiatives: Helios, Eos, Selene, Auxiliary".

5. When you're done, stop the local database:

   ```bash
   pnpm db:stop
   ```

**Keep secrets out of the repo.** `.env` and `.env.local` are already excluded from Git. The bot token and the service_role key go only in those files on your PC and in the hosting dashboards. Never put them in code or chat messages.

## Putting the tables on the real Supabase project

Do this only when you're ready. Try it on a test project first if you can. These commands log you in through your browser and then apply the migrations:

```bash
pnpm exec supabase login
```

```bash
pnpm exec supabase link --project-ref YOUR_PROJECT_REF
```

```bash
pnpm exec supabase db push
```

`YOUR_PROJECT_REF` is the code in your Supabase project's web address (`supabase.com/dashboard/project/<this part>`). `db push` creates the tables but does not load the seed data. To load it, paste the contents of `supabase/seed.sql` into the SQL editor in the Supabase dashboard and run it.

## How the permission rules work

The levels come from the "Permission levels" table in the spec. The database decides which level someone is at like this:

| Level | How Cortana decides |
| --- | --- |
| Member | Status is `active` **and** their RSI handle is verified |
| Officer | Their rank's tier is `officer` or higher (Praetor and Centurion today) |
| Director | Director or Chair rank **and** a current appointment to an initiative or division. They can only assign members inside that initiative or division. |
| Admin | A current appointment with scope `org`. Give one to the owner and to each member of =The High Table=. |

Rank changes go through `change_rank(member, new rank, reason)`, which only Admins may call. Even if someone edits the `members` table directly, a safety check blocks rank, status and verification changes unless the person is an Admin. Every rank change is written to `rank_history`. Every change to members, assignments, appointments, awards or ranks is written to `audit_log`.

## Choices made in Phase 1 that need your decision

These are written down so you can confirm or change them. Once decided, add the answer to the spec.

- **Prefect is treated as Member level for now.** The spec says Prefect might be an Officer "for their own team, to confirm".
- **Admin = anyone with a current `org`-scope appointment.** There is no separate admin list. To make someone an Admin, add that appointment. To remove them, set its end date.
- **Seeded leaders:** Hary (Chair of Helios), Chance (Chair of Eos) and Tusk (Chair of Selene), plus Wolffe as Org Chairman. All four are Admins. They aren't RSI-verified until they run `/verify`. Their Admin powers only work once each one logs in with Discord and Cortana links that login to their record; the bot and website do this from Phase 2 onwards.
- **Not seeded:** other members, awards, Discord role IDs, and a separate Salvage division (the owner decided Salvage is part of Industry). Each seeded item does store its live Discord role *name*, so Phase 2's `/setup roles` can find the matching role IDs.
- **Promotions up to Prefect by division leaders** (the owner's answer, now in the spec) arrive with Phase 2's `/promote`. Until then, only Admins can change ranks.
- **A few extra columns** not listed in the spec were added because later phases need them:
  - `discord_role_name` and `rank_role_prefix`, for matching Discord roles
  - `slug` and `sort_order`
  - `unit_id` on assignments, so `/assign` can place someone in a squadron
  - `kind` on units
  - `is_public` on operations, for "opted in per op"
  - `actor_role` on the audit log
- **The audit log column is `table_name`**, not `table`, because `table` is a reserved word in SQL.
