# HDI Cortana — System Spec & Codex Build Plan

Exported 11 November 2026 from the living spec doc. If this file and the doc disagree, the doc is newer: ask the owner to re-export.

## How to use this spec

Status: PROPOSED. Nothing here is approved HDI policy until the owner signs off.

Cortana will be one backend (a database plus an API) that the website, the Discord bot, a phone app and, later, a game overlay all read from and write to. This doc is written so Codex can build it in small, testable phases.

1. Give Codex the whole doc once as background (save it into the repo as `docs/SPEC.md`).
2. Then work one phase at a time, using the prompt for that phase in the Roadmap section.
3. After each phase, test it yourself in a test Discord server before anything touches the live HDI server or website.
4. When Codex asks a question this doc doesn't answer, decide it, then add the answer here so the spec stays the source of truth.

## Decisions so far

The owner has decided three things. The current Discord structure post (Structure.txt) is the working org structure. The website can move off Squarespace. Codex will write the code, so the stack must be simple, popular and well documented.

**The domain can stay where it is.** It was bought through Squarespace, and Squarespace domains accept custom DNS records ([Squarespace help](https://support.squarespace.com/hc/en-us/articles/360002101888-Adding-custom-DNS-records-to-your-Squarespace-managed-domain)). You point the domain at the new host with an A record and a CNAME. No transfer is needed. Before cancelling the Squarespace website plan, confirm in your Squarespace billing that the domain renews separately.

**Owner decisions, 11 November 2026.** These override the earlier briefs and Structure.txt wherever they differ.

| Topic | Decision |
| --- | --- |
| Rank ladder | Hoplite, Operator, Specialist, Prefect, Praetor, Centurion, Director, then Chair |
| Chair | The highest rank: Chair of Helios, Chair of Eos, Chair of Selene, one per home initiative (the doctrine's "Initiative Director") |
| Initiatives | Three home initiatives (Helios, Eos, Selene), plus Auxiliary |
| Auxiliary | Official name (formerly "Open Initiative"). Open to members of any home initiative, so its specialist roles are available everywhere instead of locked inside one initiative. Led by Division Directors only; no Chair or Initiative Director |
| Auxiliary divisions | Engineering, Pathfinder (intelligence), Legion Venatorum, Media |
| Wings | Squadron-level units inside the Helios Fleet Division |
| N.O.V.A. and H.E.R.D. | Medical units reporting to Helios (Medical Division) |
| Salvage | Eos (Structure.txt places it in the Industry Division) |
| Director | Director is a rank. Which division a Director runs is an appointment: Eos, for example, has Industry, Commerce, Manufacturing and Archaeology Division Directors |
| Director scope | Authority only inside their own initiative or division. The Chair of Eos has no oversight of Helios or Selene |
| Admin access | The owner plus Administration (=The High Table=) |
| Website | Out of date; initiative copy is rebuilt from this structure |

## Org model Cortana will store

Cortana stores the structure below as data in the database, loaded from a seed file. No initiative, division or rank name is written into the code. When leadership renames a division or adds one, an admin edits the data and every app updates.

| Initiative | Motto (English) | Remit | Divisions |
| --- | --- | --- | --- |
| Helios | Guardians of the Fleet, Masters of the Horizon | Fleets, personnel and orbital assets; exploration and medical support | Fleet (wings are its squadrons), Medical |
| Eos | We build the future, We fund the mission | Commerce, industry and innovation; self-sufficiency and profit | Commerce, Industry (mining, salvage), Manufacturing, Archaeology |
| Selene | On the ground, we are absolute | Planetside power: infantry, armour, atmospheric support | Legion, Armoured |
| Auxiliary | In silence, strength speaks | Specialist roles any member can join, supporting every initiative | Engineering, Pathfinder (intelligence), Legion Venatorum, Media |

Greek mottos (store with each initiative, exactly as written):

- Helios: Φύλακες τοῦ Στόλου, κυρίαρχοι τοῦ Ὁρίζοντα
- Eos: Χτίζουμε τὸ μέλλον, στηρίζουμε τὴν ἀποστολή
- Selene: Στο πεδίο, εἴμαστε ἀπόλυτοι
- Auxiliary: Ἐν σιωπῇ, ἡ ἰσχύς μιλεῖ.

**How Auxiliary membership works in Cortana.** Every member has exactly one home initiative (Helios, Eos or Selene), which carries their rank and rank role. They can also join any number of Auxiliary divisions. Auxiliary has no rank ladder of its own, so there are no A- rank roles. In the data model this is `member_assignments.is_primary`: true for the home initiative, false for Auxiliary divisions.

Rank ladder, lowest to highest (confirmed by the owner). The one-line meanings are the doctrine's working definitions and still need leadership sign-off as promotion criteria.

1. Hoplite: entry stage; onboarding and proving reliability
2. Operator: qualified participating member
3. Specialist: deeper competence in a defined field
4. Prefect: small-team supervision and standards
5. Praetor: senior member with broader leadership duties
6. Centurion: most senior non-director rank
7. Director: held by members appointed to run a division (Sub-Division Director, Division Director, or an initiative Sub-Director)
8. Chair: highest rank, one per home initiative (Chair of Helios, Eos, Selene)

Director is a rank; the post a Director holds is an appointment that belongs to a single division or initiative. Eos, for example, will have Industry, Commerce, Manufacturing and Archaeology Division Directors. The appointment is stored with that division, with a start date and a review date. A member keeps their rank when appointed or replaced.

The Discord emoji IDs for Helios, Eos and Selene are stored with each initiative, so the bot and website display them consistently: Helios `1429599840190337106`, Eos `1429599815683280926`, Selene `1429599863460466738`.

## Recommended stack

Use TypeScript everywhere, in one GitHub repository, on managed services with dashboards. That way one language covers every app, they share the same type definitions, and the owner can inspect data without writing code.

| Piece | Choice | Why it suits a Codex-built project |
| --- | --- | --- |
| Code home | One GitHub repo with pnpm workspaces (`apps/web`, `apps/bot`, `packages/shared`) | Codex works directly in a repo; shared code lives in one place |
| Database + login | Supabase (Postgres) | Built-in "Log in with Discord", a table editor that works like a spreadsheet, row-level permissions |
| Website, members area, API | Next.js, hosted on Vercel | One app serves the public site, the logged-in pages and the API; deploys on every push |
| Discord bot | discord.js, hosted on Railway | A bot must stay connected all the time, which Vercel can't do; Railway runs it as an always-on process |
| Phone app | Installable web app (PWA) from the same Next.js site | No App Store work at first; one codebase |
| Game overlay (later) | Tauri or Electron desktop app | Reads Game.log locally, calls the same API |
| Ship data | [Star Citizen Wiki API](https://api.star-citizen.wiki/developers) | Ship, item and location data as JSON; credit it on public pages |

## Architecture

No app keeps its own copy of the roster, ranks or fleet; they all go through the Cortana core, so a change made in Discord shows on the website at once.

```
  Website        Discord bot      Phone app (PWA)    Overlay (later)
  (Vercel)       (Railway)        (same site)        (desktop window)
     |               |                 |                  |
     +---------------+--------+--------+------------------+
                              |
              CORTANA CORE (single source of truth)
     Cortana API  |  Supabase database  |  Discord login
                              |
     +------------------------+-------------------------+
     |                        |                         |
 RSI public pages     Star Citizen Wiki API      Game.log on member PC
 (handle + org check, (ship catalogue,           (opt-in events only,
  unofficial)          credit required)           sent via the overlay)
```

The overlay and Game.log events come later and only with a member's opt-in. RSI data is read-only and used only for verification.

## Data model

Fifteen tables cover version 1. Every change to rank, appointment, membership or award also writes a row to `audit_log`, so leadership can see who changed what and when.

| Table | Holds | Key fields |
| --- | --- | --- |
| `members` | One row per person | discord_id, discord_name, rsi_handle, rsi_verified_at, status (applicant, active, inactive, departed), rank_id, joined_at, timezone |
| `initiatives` | Helios, Eos, Selene, Auxiliary | slug, name, motto_greek, motto_en, emoji_id, discord_role_id, is_home (false for Auxiliary), sort_order |
| `divisions` | Divisions and sub-divisions | initiative_id, parent_division_id (blank for a top-level division), name, discord_role_id |
| `ranks` | The rank ladder | name, tier, sort_order, discord_role_id per home initiative (H-, E-, S- roles) |
| `member_assignments` | Where a member works | member_id, initiative_id, division_id, is_primary |
| `appointments` | Director and lead positions | member_id, title, scope (org, initiative or division) + scope_id, starts_on, review_on, ends_on, granted_by |
| `units` | Squadrons, wings, medical units (N.O.V.A., H.E.R.D.) | name, division_id, lead_member_id, discord_role_id |
| `awards` / `member_awards` | Medals and recipients | name, description, discord_role_id; member_id, award_id, awarded_on, awarded_by, citation |
| `operations` | Planned ops and events | name, objective, lead_initiative_id, commander_id, starts_at (stored in UTC), staging, comms_channel, status, after_action |
| `op_signups` | Who is coming | operation_id, member_id, role, ship_id, status (going, maybe, declined, attended) |
| `ships` | Ship catalogue from the Wiki API | name, manufacturer, wiki_uuid, role, crew_min, crew_max |
| `member_ships` | Self-reported hangar | member_id, ship_id, source (typed or import), available_for_ops |
| `rank_history` | Every promotion or demotion | member_id, from_rank, to_rank, reason, approved_by, at |
| `audit_log` | Every sensitive change | actor_id, action, table, row_id, before, after, at |

Fleet numbers on the website come from `member_ships` and are labelled "member-reported", because RSI hangars are private and cannot be verified.

## Identity, verification and permissions

A member's Discord account is their HDI login everywhere: the website, the phone app and the overlay all use "Log in with Discord", and the bot already knows them. One person, one `members` row.

**RSI handle verification (proposed flow).** Star Citizen has no official API, so verification reads the public RSI pages, the same way other org tools do.

1. Member runs `/verify handle:<RSI handle>` in Discord.
2. The bot replies privately with a one-time code, such as `HDI-7F3K`.
3. Member pastes the code anywhere in their RSI profile bio and runs `/verify check`.
4. Cortana loads the member's public RSI profile, finds the code, and checks that HDI's public org member list includes the handle.
5. If both match, `rsi_verified_at` is set and the member can delete the code from their bio.

This method depends on RSI's page layout. When RSI changes its site, verification can break until the reader is updated. The code must fail safely: no automatic demotions or kicks based on a failed page read.

**Permission levels**

| Level | Who | Can |
| --- | --- | --- |
| Member | Any verified active member | See the roster, sign up for ops, edit own profile and hangar |
| Officer | Praetor and Centurion (Prefect for their own team, to confirm) | Create ops, take attendance, write after-action reports |
| Director | Director rank, scoped to the division or initiative in their appointment | Assign members and propose promotions inside that scope only; no access to other initiatives |
| Admin | Owner and Administration (=The High Table=) | Approve rank changes, appointments and awards; edit org structure |

The database enforces these levels (Supabase row-level security), not just the buttons on screen. Someone who calls the API directly gets the same limits.

## Discord bot, version 1

The first version of the bot does four jobs: onboarding, role sync, ops sign-ups and the roster. Cortana is the source of truth and Discord roles mirror it, never the other way round. If someone hands out a role by hand in Discord, the bot flags the mismatch to admins instead of copying it into the database.

| Command | Who | What it does |
| --- | --- | --- |
| `/enlist` | Anyone | Starts an application: RSI handle, timezone, interested initiative; creates an applicant record and pings recruiters |
| `/verify` | Applicants, members | The RSI bio-code check above |
| `/profile [member]` | Members | Shows rank, initiative, division, unit, appointments, awards |
| `/roster [initiative] [division]` | Members | Lists members, filterable |
| `/hangar add / list` | Members | Records ships from the Wiki ship list; private by default |
| `/op create` | Officers | Creates an operation with time in UTC, posts an embed with sign-up buttons |
| `/op attend` / `/op aar` | Officers | Takes attendance and records the after-action summary |
| `/assign` | Directors, admins | Sets a member's initiative, division or unit |
| `/promote` | Directors propose, admins approve | Two-step rank change with a reason, logged to `rank_history` |
| `/award` | Admins | Grants an award with a citation |
| `/setup roles` | Admins | Matches database entries to live Discord roles by name, stores their IDs, asks an admin to confirm any it can't match |

Role sync: whenever a member's rank, initiative, division, unit or award changes in Cortana, the bot sets the matching Discord roles. It keeps the role categories separate and keeps the H-, E- and S- rank prefixes. It only touches roles listed in the database, so hand-made community and notification roles are never removed.

### Live Discord server versus the confirmed structure

The live server (115 roles, read from Server Settings on 11 November 2026) already matches most of the confirmed structure.

| Confirmed structure | Live role(s) and member count | Gap or question |
| --- | --- | --- |
| Hoplite to Centurion ladder | H-, E- and S- versions of all six ranks (e.g. H-Operator 65, E-Operator 44, S-Operator 36) | None. Auxiliary needs no rank roles; members keep their home initiative's rank |
| Director and Chair ranks | Division Director (5), Sub Division Director (3), EOS Initiative Sub-Director (1), Chair of Helios / Eos / Selene (1 each) | Chairs are the top rank. The bot treats the director roles and Chair roles as rank roles |
| Helios | Helios Initiative (88); Helios - Fleet Division (72); Helios - Medical Division (19) | Matches |
| Eos | Eos Initiative (51); Eos - Commerce (4), Industry (6), Manufacturing (3), Archeology (1) Division | Matches; no Salvage role |
| Selene | Selene Initiative (43); Selene - Legion Division (37); Selene - Armored Legion Division (4) | Matches |
| Auxiliary | Auxiliary - Pathfinder Division (4), Auxiliary - Engineering Division (3), Auxiliary - Venatorum Division (3) | No Auxiliary initiative role and no Media Division role (Media Officer exists, 9) |
| Fleet units | Capital, Fighter and Support Director; Wing Commander; Fleet Lead; Capital Crew (57); Chatter, Reaper, Scar, Viper, Dagger, Mobile, Puncture and Dragon Sq | Fits Fleet Division with squadrons |
| Medical units | N.O.V.A. (13), H.E.R.D. (6) | Units under Helios Medical Division |
| Administration | =The High Table= (5) | Admin permission level |
| Awards | First 100 (64), Hunter's Mark Distinction (13), Hero Of Orison (Blue Heart) (10), Valakkar Massacre (7), Unhealthy Obsession (3) | Owner to confirm which are official awards |
| Membership | HDI (185), Looking to Enlist (1), Friends of HDI, Free Flight | HDI role = active member? |

Roles the bot must never touch: region roles (EU, USA West, USA East, South America, Australia, Asia), Patreon/booster roles, allied-org and other-org roles, Event Organizer, community roles, and every bot's own role.

**Bots.** The server runs about 14 other bots (Ship Systems, YAGPDB, Ticket Tool, Apollo, VoiceMaster and others). Keep them all until Cortana covers each job.

**Permissions.** The Cortana bot gets Manage Roles, Send Messages and Use Slash Commands, never Administrator. Keep Administrator off every role the bot assigns.

## Website: HDI Corporate Network

The Squarespace site stays live until the new one is finished. Then the domain switches over in one step. The new site has a public side that anyone can see and a members side behind "Log in with Discord".

**Public pages** (keep the current sections, rebuilt on the brand bible's dark navy, silver and restrained gold direction, marked PROPOSED until colours and fonts are approved):

- Home: "We build the future." hero, Enlist and Explore initiatives buttons
- Corporation: what HDI is, leadership (only confirmed names)
- Initiatives: one page per initiative (Helios, Eos, Selene, Auxiliary), its motto, remit and divisions, drawn from the database
- Operations: recent public after-action summaries, opted in per op
- Fleet & Assets: member-reported ship counts by class, labelled as such
- Media, Merch, Enlist

**Members area:** profile and hangar, roster, ops calendar with sign-up, own awards and rank history, and admin screens for leadership.

**Fixes to carry over from the current site:** remove leftover template headings ("# About HDI *", "# Follow us on social *") and send every Enlist button to one place, the new `/enlist` page, which starts the same application as the bot's `/enlist`. The live site's initiative copy is out of date (three initiatives, Helios as "fleet support", Eos as "enterprise").

**Domain switch, once the new site is approved:**

1. Add `hyperiondefenseindustries.com` and `www` to the project in Vercel; it shows the exact records to add.
2. In Squarespace, open Domains, then DNS settings, then Custom records, and add those records.
3. Remove the old Squarespace website records for the same hosts.
4. Leave any email (MX) records alone.
5. Wait for Vercel to show the domain as valid, then check the site on phone and desktop.

## Phone app and game overlay

**Phone app: start as an installable web app.** The members area is built mobile-first and set up as a PWA. Web push notifications cover op reminders.

**Game overlay: last, and built to stay clear of anti-cheat.** Star Citizen runs Easy Anti-Cheat. The overlay must be a separate desktop window kept on top of the game. It must never inject into the game, hook its rendering or read its memory. It may read the `Game.log` file the game writes on the player's own PC.

Overlay rules: opt-in only with a clear list of what is read and sent; nothing that gives a gameplay advantage; members told plainly that third-party overlays are used at their own risk with anti-cheat; re-check CIG's current rules on third-party tools before release.

## Roadmap and Codex prompts

Build in seven phases, each one usable and tested before the next starts.

**Phase 0: accounts (done 11 November 2026).** GitHub repo HDIAdmin-source/Cortana, Supabase project, Vercel account, Discord application with bot user, and a test Discord server, all under the HDI email. Railway project is created in Phase 2.

**Phase 1: foundation.** Done when the tables exist, the seed data loads and the permission tests pass.

```
Read docs/SPEC.md. Set up a pnpm monorepo with apps/web (Next.js, TypeScript), apps/bot (discord.js, TypeScript) and packages/shared. Create Supabase migrations for every table in the Data model section, with row-level security matching the Permission levels table. Add a seed file with the initiatives, divisions, units and ranks from the Org model and Live Discord server sections. Add automated tests proving a Member cannot change ranks and an Admin can. Write a README explaining in plain English how to run it locally.
```

**Phase 2: bot onboarding and roles.** Done when a test account can enlist, verify, and receive the right roles in the test server.

```
Read docs/SPEC.md. In apps/bot, build /setup roles, /enlist, /verify, /profile, /roster, /assign and /promote as described in the Discord bot section, using the RSI verification flow in the Identity section. Implement role sync from Cortana to Discord using discord_role_id columns, touching only roles listed in the database. Every change writes to audit_log. Failed RSI page reads must never remove roles. Add a Railway deploy config.
```

**Phase 3: operations.** Done when an officer can post an op, members sign up with buttons, and attendance is recorded.

```
Read docs/SPEC.md. Add /op create, /op attend and /op aar plus sign-up buttons, stored in operations and op_signups. Show times with Discord timestamps so each member sees their local time. Add /hangar add and /hangar list using a ships table filled from the Star Citizen Wiki API, with credit to api.star-citizen.wiki.
```

**Phase 4: website.** Done when the new site matches the current content, login works, and the owner has approved the look. Start by running the setup at vercel.com/get-started.md, with confirmation on for every deploy.

```
Read docs/SPEC.md. In apps/web, rebuild the public pages listed in the Website section with a dark navy, silver and restrained gold theme kept in one theme file (PROPOSED, not final). Initiative pages read from the database. Add Log in with Discord through Supabase and a members area with profile, hangar, roster and ops calendar. Add admin screens for assignments, promotions and awards that call the same database rules as the bot.
```

**Phase 5: phone.** Make the members area an installable PWA with web push reminders 24 hours and 1 hour before ops a member signed up for.

**Phase 6: overlay.** Later, from the Phone app and game overlay section, after the first five phases are stable.

The domain switch happens between Phase 4 and Phase 5.

## Security rules

- Secrets (the bot token, the Supabase service key) live only in the hosting dashboards' environment settings, never in the repo.
- Two-factor login on GitHub, Discord, Supabase, Vercel, Railway and Squarespace.
- Test every phase in the test Discord server first.
- Supabase backups on, with one practice restore.
- Changes go in branches; the owner reviews the summary before merging to main. Main is what goes live.
- Collect the minimum about members: Discord ID, RSI handle, timezone. Add a private-profile option and a way for a member to have their data deleted when they leave.

## Open questions (answer before the phase shown)

- Should Discord get an Auxiliary initiative role and an Auxiliary - Media Division role? (Phase 2)
- Is Salvage its own role or part of Eos - Industry Division? (Phase 2)
- Which award roles are official awards? (Phase 2)
- Who may approve promotions at each rank level? (Phase 2)
- Are the recorded leaders (Hary, Hall, Tusk, Wolffe and the fleet leads) current and safe to seed? (Phase 2)
- Is HDI's RSI org page member list public, and does HDI add people there only after a trial period? (Phase 2)
- Where should merch live after Squarespace? (Phase 4)
- Approved logo files, colour values and fonts for the website theme. (Phase 4)
