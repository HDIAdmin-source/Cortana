# HDI Cortana

Cortana is the single backend for Hyperion Defense Industries. It holds one database plus a set of rules, and the website, the Discord bot, the phone app and (later) the game overlay all read from it and write to it. The full plan is in [docs/SPEC.md](docs/SPEC.md).

What's built so far:

- **Phase 1, foundation:** the project layout, the database tables, the permission rules, the starting org data and the leaders.
- **Phase 2, bot onboarding and roles:** the Discord bot's `/setup`, `/enlist`, `/verify`, `/profile`, `/roster`, `/assign` and `/promote` commands; Discord roles that follow Cortana automatically; and a config for running the bot on Railway.
- **Phase 3, operations:**
  - `/op create` posts an operation with sign-up buttons.
  - `/op attend` takes attendance, `/op aar` writes the after-action report, and `/op cancel` cancels.
  - `/hangar` lists a member's ships, using the Star Citizen Wiki's ship list.

## What's in here

| Folder | What it is |
| --- | --- |
| `apps/web` | The website (Next.js). For now it is one page that lists the initiatives from the database. |
| `apps/bot` | The Discord bot (discord.js). `src/commands` holds one file per slash command, `src/sync` keeps Discord roles in line with Cortana, `src/ops` draws the op posts, `src/rsi.ts` reads RSI's public pages for `/verify`, and `src/wiki.ts` loads ships from the Star Citizen Wiki. |
| `packages/shared` | Code both apps use, such as the shapes of database rows. |
| `supabase/migrations` | The database setup, run in order: tables, permissions, rank-change and audit rules, then the Phase 2 bot rules. |
| `supabase/seed.sql` | The starting data: 4 initiatives, 12 divisions, 10 units (8 Fleet squadrons, N.O.V.A. and H.E.R.D.), the 8-rank ladder, the confirmed leaders (the three Chairs and Wolffe as Org Chairman), and the org settings (RSI tag `OLDHUNTERS`, active-member role `HDI`). |
| `tests` | Automated checks of the permission rules, the bot's database rules, role syncing and the RSI reader. |
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

**Keep the project in a short folder path**, such as `F:\Cortana` or `C:\Users\<you>\code\cortana`. Windows can't start programs whose full path is longer than 260 characters, and a deeply nested folder pushes some of the project's tools past that limit. When that happens, you get a "spawn … ENOENT" error even though the file exists.

Then move your terminal into the project folder. Every `pnpm` command in this README must be run from there, not from your home folder:

```bash
cd F:\Cortana
```

Download everything the project depends on:

```bash
pnpm install
```

pnpm only lets a package run its own setup scripts if the project approves it. That approval list is `allowBuilds` in `pnpm-workspace.yaml`, and `esbuild`, which the tests need, is already on it. If a future install says "Ignored build scripts", run `pnpm approve-builds` and approve only packages you recognise.

## Run the tests (no database, Docker or Discord needed)

```bash
pnpm test
```

The tests start a temporary database in memory, apply every migration and the seed file, then act as different people:

- **A Member** tries to promote themselves, change someone else's rank, rename the ranks and forge rank history. Every attempt must fail.
- **An Admin** changes, demotes and approves ranks. It must work, and each change must be recorded in `rank_history` and `audit_log` with who did it.
- **A Chair** and **a Division Director** assign and promote people. They must stay inside their own initiative or division, and must stop at Prefect, where their promotions become proposals.
- **An applicant** goes through `/enlist`, `/verify` and acceptance by `/assign`.
- **Role syncing** must give a member exactly their initiative, division, rank and HDI roles, and must never touch any other role.
- **The RSI reader** must say "couldn't check" when RSI is down or changes its pages, never "failed".
- **Operations:**
  - Only Officers create ops and take attendance, and ordinary members and Prefects are refused.
  - Verified members sign up, change their mind, and pick a ship from their own hangar only.
  - Attendance includes walk-ins, and members can't undo it themselves.
  - The after-action report closes the op.
  - Op posts stay within Discord's size limits even with 300 sign-ups.
- **Hangars** are private: Officers only see ships a member has offered for ops.
- **UTC times:** start times are read strictly as UTC, so "20/11 7pm" is refused instead of guessed.

A green "passed" line means the database itself enforces the rules, so going around the website or bot doesn't get around them.

To check the RSI reader against the real RSI site (needs the internet), give it any handle that's listed in the HDI org:

```bash
pnpm --filter @cortana/bot rsi-smoke SomeHandle
```

To check the ship reader against the real Star Citizen Wiki API:

```bash
pnpm --filter @cortana/bot wiki-smoke
```

## Run it locally

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

4. **Bot:** follow the next section.

5. When you're done, stop the local database:

   ```bash
   pnpm db:stop
   ```

**Keep secrets out of the repo.** `.env` and `.env.local` are already excluded from Git. The bot token and the service_role key go only in those files on your PC and in the hosting dashboards. Never put them in code or chat messages.

## Set up the Discord bot in your TEST server

Use the HDI **test** Discord server for all of this. Point the bot at the live server only once the owner has approved Phase 2.

### 1. Discord Developer Portal (once)

Open [discord.com/developers/applications](https://discord.com/developers/applications) and select your Cortana application.

1. **Bot** page: turn on **Server Members Intent**, then save. The bot needs it to notice roles handed out by hand. Without it, the bot can't log in.
2. **Bot** page: click **Reset Token** and copy the token. It goes in `.env` below; don't share it.
3. **General Information** page: copy the **Application ID**.

### 2. Invite the bot to the test server (once)

Open this link, with `YOUR_APPLICATION_ID` replaced by the Application ID, and pick the test server:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot+applications.commands&permissions=268438528
```

The bot only asks for **Manage Roles**, **Send Messages** and **View Channels**, plus slash commands, **never Administrator**.

Then, in the test server's **Server Settings → Roles**, drag the bot's role **above** every rank, initiative, division, unit and HDI role. A bot can only hand out roles that sit below its own. Also check that none of those roles has the Administrator permission. `/setup roles` warns you if one does.

### 3. Fill in `apps/bot/.env`

Copy `apps/bot/.env.example` to `apps/bot/.env` and fill it in. In Discord, turn on **Settings → Advanced → Developer Mode**; you can then right-click a server, channel or role and choose **Copy ID**.

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`: from step 1.
- `DISCORD_GUILD_ID`: the test server's ID.
- `ADMIN_CHANNEL_ID` (optional): a staff-only channel. Role mismatches and promotion proposals are posted there.
- `RECRUITMENT_CHANNEL_ID` and `RECRUITER_ROLE_ID` (optional): where new applications are posted, and who gets pinged.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: from `pnpm db:start` for local testing.

### 4. Register the commands, then start the bot

```bash
pnpm --filter @cortana/bot register
```

That tells Discord about the slash commands. Run it again whenever a command changes.

```bash
pnpm dev:bot
```

It should print "logged in as …" and "Database OK. Initiatives: Helios, Eos, Selene, Auxiliary". Leave it running.

### 5. Connect Cortana to the server's roles

The seeded Admins (Wolffe, Chance, Hary and Tusk) are recognised by their Discord IDs, so they can use Admin commands straight away. One of them runs:

- `/setup roles`. The bot matches Cortana's entries to roles by name, such as `H-Operator`, `Eos - Industry Division`, `Chair of Helios` and `HDI`. It saves the matches and lists any it couldn't match.
- `/setup link` for each one that didn't match. Pick the Cortana entry, then the Discord role.

## Try the whole onboarding flow (Phase 2 "done" check)

Use a second Discord account that isn't in Cortana yet as the "recruit".

1. **Recruit:** `/enlist`, giving their RSI handle, time zone and initiative. They become an applicant, and recruiters are pinged if you set that up.
2. **Recruit:** `/verify handle`, then paste the code (such as `HDI-7F3K`) into their RSI **Short Bio** and run `/verify check`. Cortana checks the bio has the code and that the handle is in HDI's public RSI member list. If their org membership is hidden on RSI, an Admin can use `/verify manual` instead.
3. **A leader** (the Chair of that initiative, a Division Director for their division, or an Admin): `/assign`, choosing the recruit, initiative and division. This accepts them as an **active Hoplite**, and the bot gives them the HDI, initiative, division and `X-Hoplite` roles.
4. **The leader:** `/promote member` up to Prefect takes effect immediately, and the bot swaps the rank role. Promoting to Praetor or above becomes a proposal, which an Admin approves with `/promote decide`.
5. **Anyone verified:** `/profile` and `/roster`.
6. **Try the safety net:** hand the recruit a rank role by hand in Discord. The bot posts a mismatch warning in the admin channel and changes nothing.

Every change above is written to `audit_log` with who made it. You can view it in Supabase Studio.

## Try operations and hangars (Phase 3 "done" check)

The spec's check: an officer can post an op, members sign up with buttons, and attendance is recorded. You need one Officer, meaning a Praetor or above, or an Admin. You also need at least one verified active member; use `/promote` to make a test account a Praetor.

1. **Ship list:** the bot loads it from the Star Citizen Wiki the first time it starts. To refresh it later, an Admin runs `/setup ships`.
2. **Member:** `/hangar add`. Start typing a ship name and pick it from the list. Choose `available: True` to offer it for ops. Check with `/hangar list`. Hangars are private: other members can't see them, and Officers only see ships offered for ops.
3. **Officer**, in the channel where the op should be posted: `/op create`, with a name and a `start` in **UTC** written as `2026-11-20 19:00`. Optionally add an objective, lead initiative, staging point and voice channel.
   - The bot posts the op with **Going / Maybe / Can't make it / My ship & role** buttons.
   - Everyone sees the time in their own time zone.
   - The bot also tells the officer what the time works out to locally, so a wrong UTC conversion is easy to spot.
4. **Members:** click **Going** or **Maybe**, then pick a ship from their hangar and set a role (Pilot, Medic…). The post updates with who's coming.
5. **Officer**, after the op: `/op attend`, choosing the op and then the people who turned up (up to 25 at a time, including people who didn't sign up). Use `remove: True` to fix a mistake. The post shows who attended.
6. **Officer:** `/op aar` opens a form for the after-action report. It's saved, and the op is marked completed and its buttons disappear. `public: True` lets the future website show the report; the default keeps it members-only.
7. `/op cancel` cancels an op that won't happen.

Ship data comes from the [Star Citizen Wiki API](https://api.star-citizen.wiki) and is credited wherever the bot shows it. Hangar numbers are member-reported and not checked against RSI.

## Run the bot on Railway (always on)

The website runs on Vercel, but a bot has to stay connected all the time, so it runs on Railway. Do this only after the test server checks pass.

1. In Railway, create a project, then **New → GitHub Repo → HDIAdmin-source/Cortana**.
2. In the service's **Settings**:
   - **Root Directory:** leave it empty, because the bot needs the whole repo.
   - **Config file path:** `apps/bot/railway.json`. That file sets the start command, and only redeploys when bot code changes.
3. In **Variables**, add everything from `apps/bot/.env`, but with the **real Supabase project's** URL and service_role key (Supabase dashboard → Project Settings → API). Railway keeps them secret; they never go in the repo.
4. Deploy. The logs should show "logged in as …" and "Database OK".
5. Register the commands for that server once. On your PC, with `apps/bot/.env` pointing at the same server, run `pnpm --filter @cortana/bot register`.

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
| Director | Director or Chair rank **and** a current appointment to an initiative (Chairs) or a division (Division Directors). Inside that scope only, they can accept and assign members and promote up to Prefect; higher promotions become proposals. |
| Admin | A current appointment with scope `org`. Give one to the owner and to each member of =The High Table=. |

The website will connect as a logged-in user, so row-level security applies to it. The bot connects with the service-role key, which skips row-level security. So the bot never edits tables directly. Every action goes through a `bot_*` function in the database. That function takes the Discord ID of whoever ran the command, applies the same rules, and records that person in `audit_log`. Only the bot's key can call those functions.

Some rules are stored as data, so leaders can change them without code:

- which ranks division leaders may approve: `ranks.leader_can_approve`
- how rank roles are named in Discord: `ranks.discord_role_name_pattern`
- the RSI org tag and the active-member role: the `org_settings` table

## Choices made so far that need your decision

These are written down so you can confirm or change them. Once decided, add the answer to the spec.

- **Prefect is treated as Member level** (not Officer) for ops permissions. The spec says "to confirm".
- **Admin = anyone with a current `org`-scope appointment.** To make someone an Admin, add that appointment. To remove them, set its end date.
- **Promotions are judged by the member's home initiative and division.** An Auxiliary Division Director can't promote someone whose home is in another initiative, because the rank belongs to the home initiative.
- **Demotions are Admin-only**, and **nobody can change their own rank**, Admins included.
- **Director roles:** the bot manages one "Division Director" role for the Director rank. The live "Sub Division Director" and "EOS Initiative Sub-Director" roles are still handed out by hand.
- **Awards are not synced** to Discord yet; the owner deferred awards.
- **Existing members aren't imported yet.** Cortana only manages roles for people it knows about: the seeded leaders, and anyone who enlists. Everyone else's roles are left completely alone. Importing the current ~185 members is a separate step to plan before going live. Until then, a leader's hand-given division roles will show up as mismatches once roles are linked.
- **Ops are posted in the channel where `/op create` is run**, and **any Officer can run any op**: take attendance, write the report or cancel it, not just its commander. Each officer is named in `audit_log`.
- **Attendance is taken 25 people at a time**, a Discord limit on pickers; run `/op attend` again for bigger ops. Marking attendance moves a planned op to "under way".
- **Signing up needs a verified active member**; applicants can't sign up yet.
- **Ships are never deleted** from the catalogue when the Wiki drops one, because members' hangars point at them. Duplicate "display" models from the Wiki are skipped.
- **Tables added beyond the spec's fifteen:** `org_settings` (RSI tag and HDI role), `promotion_requests` (proposals waiting for an Admin) and `verification_codes` (one-time `/verify` codes).
- **Extra columns** added for the bot and later phases:
  - `discord_role_name`, `rank_role_prefix` and `discord_role_name_pattern`, for matching Discord roles
  - `slug` and `sort_order`
  - `unit_id` on assignments
  - `kind` on units
  - `is_public` on operations, plus `discord_channel_id`, `discord_message_id` and `created_by` so the bot can update an op's post
  - `wiki_slug`, `size`, `career` and `kind` (spaceship or ground) on ships
  - `interested_initiative_id` on members
  - `leader_can_approve` on ranks
  - `actor_role` on the audit log
- **The audit log column is `table_name`**, not `table`, because `table` is a reserved word in SQL.
