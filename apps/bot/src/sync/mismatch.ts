import type { GuildMember, PartialGuildMember } from "discord.js";
import { rpc } from "../db";
import { notifyAdmins, type Ctx } from "../context";
import type { RoleState } from "../types";
import { isNoop, planRoles } from "./plan";
import { wasRecentlySynced } from "./apply";

/**
 * "If someone hands out a role by hand in Discord, the bot flags the mismatch to admins
 * instead of copying it into the database." (docs/SPEC.md)
 * This only REPORTS. It never changes roles or the database.
 */
const lastFlagged = new Map<string, number>();
const FLAG_EVERY_MS = 10 * 60_000;

export async function onMemberUpdate(
  ctx: Ctx,
  before: GuildMember | PartialGuildMember,
  after: GuildMember,
): Promise<void> {
  if (after.guild.id !== ctx.env.guildId) return;
  if (!before.partial) {
    const a = [...before.roles.cache.keys()].sort().join();
    const b = [...after.roles.cache.keys()].sort().join();
    if (a === b) return; // nickname/avatar change etc.
  }
  if (wasRecentlySynced(after.id)) return;

  const flaggedAt = lastFlagged.get(after.id);
  if (flaggedAt !== undefined && Date.now() - flaggedAt < FLAG_EVERY_MS) return;

  const state = await rpc<RoleState>(ctx.db, "bot_role_state", { p_discord_id: after.id });
  if (!state.in_cortana) return; // not in Cortana yet: nothing to compare

  const roles = after.guild.roles.cache;
  const desired = (state.desired ?? []).filter((id) => roles.has(id));
  const current = after.roles.cache.filter((r) => r.id !== after.guild.id).map((r) => r.id);
  const plan = planRoles(current, desired, state.managed ?? []);
  if (isNoop(plan)) return;

  lastFlagged.set(after.id, Date.now());
  const name = (id: string) => roles.get(id)?.name ?? id;
  const lines = [`⚠️ Role mismatch for <@${after.id}> (${after.user.tag}). Cortana was not changed.`];
  if (plan.remove.length) lines.push(`• Has, but Cortana doesn't list: ${plan.remove.map(name).join(", ")}`);
  if (plan.add.length) lines.push(`• Missing, but Cortana lists: ${plan.add.map(name).join(", ")}`);
  lines.push("To match Discord to Cortana: `/setup sync`. To change Cortana: `/assign` or `/promote`.");
  await notifyAdmins(ctx, lines.join("\n"));
}
