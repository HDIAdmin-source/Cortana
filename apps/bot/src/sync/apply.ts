import type { Guild } from "discord.js";
import { rpc } from "../db";
import type { Ctx } from "../context";
import { notifyAdmins } from "../context";
import type { RoleState } from "../types";
import { isNoop, planRoles } from "./plan";

export interface SyncReport {
  status: "not_in_cortana" | "not_in_server" | "unchanged" | "updated";
  added: string[]; // role names
  removed: string[];
  /** Roles Cortana wanted to change but the bot can't (missing, above the bot, or managed by an integration). */
  skipped: string[];
}

// The bot's own role changes trigger member-update events; ignore those for a moment so
// they aren't reported as mismatches.
const recentlySynced = new Map<string, number>();
const SELF_CHANGE_WINDOW_MS = 15_000;

export function wasRecentlySynced(discordId: string): boolean {
  const at = recentlySynced.get(discordId);
  return at !== undefined && Date.now() - at < SELF_CHANGE_WINDOW_MS;
}

async function guildRoles(guild: Guild) {
  return guild.roles.cache.size > 1 ? guild.roles.cache : await guild.roles.fetch();
}

/**
 * Make a member's managed Discord roles match Cortana. Only roles listed in the database are
 * touched; every other role the member has is kept exactly as it is.
 */
export async function syncMember(ctx: Ctx, guild: Guild, discordId: string, reason: string): Promise<SyncReport> {
  const empty = { added: [], removed: [], skipped: [] };
  const state = await rpc<RoleState>(ctx.db, "bot_role_state", { p_discord_id: discordId });
  if (!state.in_cortana) return { status: "not_in_cortana", ...empty };

  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) return { status: "not_in_server", ...empty };

  const roles = await guildRoles(guild);
  const current = member.roles.cache.filter((r) => r.id !== guild.id).map((r) => r.id);
  const plan = planRoles(current, state.desired ?? [], state.managed ?? []);
  if (isNoop(plan)) return { status: "unchanged", ...empty };

  const canEdit = (id: string) => {
    const role = roles.get(id);
    return !!role && role.editable && !role.managed;
  };
  const add = plan.add.filter(canEdit);
  const remove = plan.remove.filter(canEdit);
  const skipped = [...plan.add, ...plan.remove].filter((id) => !canEdit(id));
  const name = (id: string) => roles.get(id)?.name ?? `unknown role ${id}`;

  if (add.length || remove.length) {
    const removeSet = new Set(remove);
    const final = [...current.filter((id) => !removeSet.has(id)), ...add];
    recentlySynced.set(discordId, Date.now());
    await member.roles.set(final, `Cortana: ${reason}`.slice(0, 500));
  }

  if (skipped.length) {
    await notifyAdmins(
      ctx,
      `⚠️ Couldn't change these roles for <@${discordId}>: ${skipped.map(name).join(", ")}. ` +
        `The role may be deleted, or sit above the Cortana bot's role in Server Settings > Roles.`,
    );
  }

  return {
    status: add.length || remove.length ? "updated" : "unchanged",
    added: add.map(name),
    removed: remove.map(name),
    skipped: skipped.map(name),
  };
}

/** One line for a command reply. */
export function describeSync(report: SyncReport): string {
  switch (report.status) {
    case "not_in_cortana":
      return "";
    case "not_in_server":
      return "Discord roles: they aren't in this server, so no roles were changed.";
    case "unchanged":
      return report.skipped.length
        ? `Discord roles: couldn't change ${report.skipped.join(", ")} (admins have been told).`
        : "Discord roles: already up to date.";
    case "updated": {
      const parts = [];
      if (report.added.length) parts.push(`added ${report.added.join(", ")}`);
      if (report.removed.length) parts.push(`removed ${report.removed.join(", ")}`);
      if (report.skipped.length) parts.push(`couldn't change ${report.skipped.join(", ")}`);
      return `Discord roles: ${parts.join("; ")}.`;
    }
  }
}
