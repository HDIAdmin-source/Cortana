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

/** Join lines into one Discord message (2000 characters max), ending with "…and N more" if needed. */
export function fitMessage(lines: string[], limit = 2000): string {
  const out: string[] = [];
  let length = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const more = `…and ${lines.length - i} more.`;
    if (length + line.length + 1 + more.length > limit) {
      out.push(more);
      break;
    }
    out.push(line);
    length += line.length + 1;
  }
  return out.join("\n");
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
    .addSubcommand((s) =>
      s
        .setName("roles")
        .setDescription("Match Cortana's ranks, initiatives, divisions and units to roles by name")
        .addBooleanOption((o) =>
          o.setName("create_missing").setDescription("Also create any role that doesn't exist yet, with no permissions (handy for a test server)"),
        ),
    )
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

      const createMissing = interaction.options.getBoolean("create_missing") ?? false;
      const links: RoleLink[] = [];
      const unmatched: string[] = [];
      const created: string[] = [];
      const warnings = new Set<string>();
      let alreadyLinked = 0;

      for (const t of targets) {
        if (!t.expected_name) continue; // no Discord role for this entry (e.g. Auxiliary)
        const key = t.expected_name.trim().toLowerCase();
        let found = byName.get(key) ?? [];

        // Create it if asked, once per name (e.g. one "Division Director" for all three initiatives).
        // New roles get NO permissions, so the bot can never hand out anything dangerous.
        if (found.length === 0 && createMissing) {
          const role = await guild.roles.create({
            name: t.expected_name.trim(),
            permissions: [],
            mentionable: false,
            reason: `Cortana /setup roles by ${interaction.user.tag}`,
          });
          byName.set(key, [role]);
          created.push(role.name);
          found = [role];
        }

        if (found.length !== 1) {
          unmatched.push(`• ${t.label}: "${t.expected_name}"${found.length > 1 ? " (several roles have that name)" : ""}`);
          continue;
        }
        const role = found[0]!;
        roleWarnings(role).forEach((w) => warnings.add(w));
        if (t.role_id === role.id) alreadyLinked++;
        else links.push({ kind: t.kind, id: t.id, slug: t.slug, role_id: role.id });
      }

      const saved = links.length ? await rpc<number>(ctx.db, "bot_set_role_ids", { p_actor_discord: interaction.user.id, p_links: links }) : 0;
      ctx.lookups.invalidate();

      const parts = [
        `Linked **${saved}** role(s); **${alreadyLinked}** were already linked.`,
        created.length ? `Created **${created.length}** new role(s) with no permissions: ${created.join(", ")}.` : "",
        warnings.size ? `**Please fix:**\n${[...warnings].join("\n")}` : "",
      ];
      if (unmatched.length) {
        const intro = `**Couldn't match ${unmatched.length}.** Rename the Discord role to match, link it with \`/setup link\`, or run \`/setup roles create_missing:True\` to create them:`;
        parts.push(intro, ...unmatched);
      } else {
        parts.push("Everything matched. ✅");
      }
      await interaction.editReply(fitMessage(parts.filter(Boolean)));
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
