# Instructions for AI coding agents (Codex)

This repository is Cortana, the shared backend, Discord bot and website for Hyperion Defense Industries (HDI), a Star Citizen organization.

## Read first

- Read `docs/SPEC.md` before every task. It is the source of truth for the org structure, data model, permissions, stack and build phases.
- Work on one roadmap phase at a time, and only the phase the owner asks for.
- If the spec doesn't answer something that changes behaviour, permissions or data, stop and ask the owner. Don't guess. Never invent ranks, divisions, members, awards or ships.

## The owner is not a programmer

- Explain what you changed and how to test it in plain English, step by step.
- Keep the README up to date with how to run each app locally.
- Prefer simple, popular, well-documented tools over clever ones.

## Safety rules (never break these)

- Never commit secrets: Discord bot tokens, Supabase service-role keys, API keys or passwords. Use environment variables, keep a `.env.example` with placeholder values, and make sure `.env*` files are in `.gitignore`.
- Never give the Discord bot the Administrator permission. It needs Manage Roles, Send Messages and Use Slash Commands.
- The bot only adds or removes roles that are listed in the database. It never touches any other role.
- A failed RSI page read must never demote, remove roles from or kick anyone.
- Every change to rank, appointment, membership or award writes a row to `audit_log`.
- Permissions are enforced in the database (Supabase row-level security), not just in the UI.
- Test against the HDI test Discord server, never the live server, until the owner says a phase is approved.
- Work on a branch and open a pull request with a plain-English summary. Don't push directly to `main`.

## Stack

TypeScript everywhere; pnpm workspaces (`apps/web`, `apps/bot`, `packages/shared`); Supabase (Postgres, Discord login, row-level security); Next.js on Vercel; discord.js on Railway. Ship data comes from the Star Citizen Wiki API (credit api.star-citizen.wiki on public pages).
