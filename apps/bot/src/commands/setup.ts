import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type Role } from "discord.js";
import { rpc, UserFacingError } from "../db";
import { choices } from "../lookups";
import { describeSync, syncMember } from "../sync/apply";
import type { RoleLink, RoleTarget, WhoAmI } from "../types";
import { syncShips, WIKI_CREDIT } from "../wiki";
import type { Command } from "./types";

async function requireAdmin(ctx: Parameters<Command["execute"]>[0], discordId: string) {
  const me = await rpc<WhoAmI>(ctx.db, "bot_whoami", { p_discord_id: discordId });
  if (!me.is_admin) throw new UserFacingError("Only an Admin can use `/setup`.");
}

/** Warnings for a role the bot is about to manage. */
function roleWarnings(role: Role): string[] {
  const w: string[] = [];
  if (role.permissions.has(PermissionFlagsBits.Administrator)) {
    w.push(`**${role.name}** has the Administrator permission. The bot must never hand that out: remove it from the role.`);
  }
  if (!role.editable) {
    w.push(`**${role.name}** is above the Cortana bot's role, so the bot can't give or remove it. Drag the bot's role higher in Server Settings > Roles.`);
  }
  return w;
}

const encode = (t: RoleTarget) => `${t.kind}|${t.id ?? ""}|${t.slug ?? ""}`;
function decode(value: string): Omit<RoleLink, "role_id"> {
  const [kind, id, slug] = value.split("|");
  return { kind: kind as RoleLink["kind"], id: id || null, slug: slug || null };
}

export const setup: Command = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Admins: connect Cortana to this server's roles")
    .addSubcommand((s) => s.setName("roles").setDescription("Match Cortana's ranks, initiatives, divisions and units to roles by name"))
    .addSubcommand((s) =>
      s
        .setName("link")
        .setDescription("Link one Cortana entry to a role by hand (for names that didn't match)")
        .addStringOption((o) => o.setName("entry").setDescription("Cortana entry").setRequired(true).setAutocomplete(true))
        .addRoleOption((o) => o.setName("role").setDescription("Discord role").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("sync")
        .setDescription("Make a member's Discord roles match Cortana now")
        .addUserOption((o) => o.setName("member").setDescription("Who").setRequired(true)),
    )
    .addSubcommand((s) => s.setName("ships").setDescription("Refresh the ship list from the Star Citizen Wiki")),

  async autocomplete(ctx, interaction) {
    const targets = await rpc<RoleTarget[]>(ctx.db, "bot_role_targets");
    const focused = interaction.options.getFocused();
    await interaction.respond(
      choices(targets, focused, (t) => ({ name: `${t.label}${t.role_id ? " ✅" : ""}`, value: encode(t) })),
    );
  },

  async execute(ctx, interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await requireAdmin(ctx, interaction.user.id);
    const guild = interaction.guild!;
    const sub = interaction.options.getSubcommand();

    if (sub === "roles") {
      const [targets, roles] = await Promise.all([rpc<RoleTarget[]>(ctx.db, "bot_role_targets"), guild.roles.fetch()]);
      const byName = new Map<string, Role[]>();
      for (const role of roles.values()) {
        const key = role.name.trim().toLowerCase();
        byName.set(key, [...(byName.get(key) ?? []), role]);
      }

      const links: RoleLink[] = [];
      const unmatched: string[] = [];
      const warnings = new Set<string>();
      let alreadyLinked = 0;

      for (const t of targets) {
        if (!t.expected_name) continue; // no Discord role for this entry (e.g. Auxiliary)
        const found = byName.get(t.expected_name.trim().toLowerCase()) ?? [];
        if (found.length !== 1) {
          unmatched.push(`• ${t.label}: expected a role named "${t.expected_name}"${found.length > 1 ? " (several roles have that name)" : ""}`);
          continue;
        }
        const role = found[0]!;
        roleWarnings(role).forEach((w) => warnings.add(w));
        if (t.role_id === role.id) alreadyLinked++;
        else links.push({ kind: t.kind, id: t.id, slug: t.slug, role_id: role.id });
      }

      const saved = links.length ? await rpc<number>(ctx.db, "bot_set_role_ids", { p_actor_discord: interaction.user.id, p_links: links }) : 0;
      ctx.lookups.invalidate();

      const lines = [
        `Linked **${saved}** role(s); **${alreadyLinked}** were already linked.`,
        unmatched.length
          ? `\n**Couldn't match ${unmatched.length}.** Rename the Discord role to match, or link it by hand with \`/setup link\`:\n${unmatched.join("\n")}`
          : "Everything matched. ✅",
        warnings.size ? `\n**Please fix:**\n${[...warnings].join("\n")}` : "",
      ];
      await interaction.editReply(lines.filter(Boolean).join("\n").slice(0, 2000));
      return;
    }

    if (sub === "link") {
      const role = interaction.options.getRole("role", true) as Role;
      if (role.id === guild.id || role.managed) {
        throw new UserFacingError("That role can't be managed by Cortana (it's @everyone or belongs to an integration).");
      }
      const link: RoleLink = { ...decode(interaction.options.getString("entry", true)), role_id: role.id };
      const saved = await rpc<number>(ctx.db, "bot_set_role_ids", { p_actor_discord: interaction.user.id, p_links: [link] });
      ctx.lookups.invalidate();
      if (!saved) throw new UserFacingError("I couldn't find that Cortana entry. Pick one from the list.");
      await interaction.editReply([`Linked to **${role.name}**.`, ...roleWarnings(role)].join("\n"));
      return;
    }

    if (sub === "ships") {
      try {
        const count = await syncShips(ctx.db);
        await interaction.editReply(`Ship list refreshed: **${count}** ships and vehicles. ${WIKI_CREDIT}.`);
      } catch (err) {
        console.error("Ship sync failed:", err);
        throw new UserFacingError("I couldn't read the Star Citizen Wiki right now. The ship list hasn't changed; try again later.");
      }
      return;
    }

    // sync
    const target = interaction.options.getUser("member", true);
    const sync = await syncMember(ctx, guild, target.id, `Manual sync by ${interaction.user.tag}`);
    await interaction.editReply(
      sync.status === "not_in_cortana"
        ? `<@${target.id}> isn't in Cortana, so I left their roles alone.`
        : describeSync(sync),
    );
  },
};
