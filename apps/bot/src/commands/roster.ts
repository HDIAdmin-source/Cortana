import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { rpc } from "../db";
import { choices } from "../lookups";
import type { RosterEntry } from "../types";
import type { Command } from "./types";

const MAX_LINES = 60;

export const roster: Command = {
  data: new SlashCommandBuilder()
    .setName("roster")
    .setDescription("List active members, optionally by initiative and division")
    .addStringOption((o) => o.setName("initiative").setDescription("Only this initiative").setAutocomplete(true))
    .addStringOption((o) => o.setName("division").setDescription("Only this division").setAutocomplete(true)),

  async autocomplete(ctx, interaction) {
    const org = await ctx.lookups.get();
    const focused = interaction.options.getFocused(true);
    if (focused.name === "initiative") {
      await interaction.respond(choices(org.initiatives, focused.value, (i) => ({ name: i.name, value: i.slug })));
    } else {
      const init = interaction.options.getString("initiative");
      const divs = org.divisions.filter((d) => !init || d.initiative_slug === init);
      await interaction.respond(choices(divs, focused.value, (d) => ({ name: d.name, value: d.slug })));
    }
  },

  async execute(ctx, interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const initiative = interaction.options.getString("initiative");
    const division = interaction.options.getString("division");
    const list = await rpc<RosterEntry[]>(ctx.db, "bot_roster", {
      p_actor_discord: interaction.user.id,
      p_initiative_slug: initiative,
      p_division_slug: division,
    });

    const org = await ctx.lookups.get();
    const title = [
      org.initiatives.find((i) => i.slug === initiative)?.name,
      org.divisions.find((d) => d.slug === division && (!initiative || d.initiative_slug === initiative))?.name,
    ]
      .filter(Boolean)
      .join(" / ");

    const lines = list.slice(0, MAX_LINES).map((m) => `**${m.rank ?? "No rank"}** · ${m.discord_name}${m.home && !initiative ? ` · ${m.home}` : ""}`);
    if (list.length > MAX_LINES) lines.push(`…and ${list.length - MAX_LINES} more. Narrow it down with the initiative or division options.`);

    const embed = new EmbedBuilder()
      .setTitle(`Roster${title ? `: ${title}` : ""} (${list.length})`)
      .setDescription(lines.join("\n").slice(0, 4000) || "No active members match.");
    await interaction.editReply({ embeds: [embed] });
  },
};
