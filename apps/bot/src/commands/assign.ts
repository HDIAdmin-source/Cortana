import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { rpc } from "../db";
import { choices } from "../lookups";
import { describeSync, syncMember } from "../sync/apply";
import type { Command } from "./types";

export const assign: Command = {
  data: new SlashCommandBuilder()
    .setName("assign")
    .setDescription("Directors and Admins: set a member's initiative, division or unit (accepts verified applicants)")
    .addUserOption((o) => o.setName("member").setDescription("Who to assign").setRequired(true))
    .addStringOption((o) => o.setName("initiative").setDescription("Initiative").setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName("division").setDescription("Division").setAutocomplete(true))
    .addStringOption((o) => o.setName("unit").setDescription("Unit (squadron, medical unit)").setAutocomplete(true))
    .addBooleanOption((o) => o.setName("remove").setDescription("Remove them from this Auxiliary division instead")),

  async autocomplete(ctx, interaction) {
    const org = await ctx.lookups.get();
    const focused = interaction.options.getFocused(true);
    const init = interaction.options.getString("initiative");
    const div = interaction.options.getString("division");
    if (focused.name === "initiative") {
      await interaction.respond(choices(org.initiatives, focused.value, (i) => ({ name: i.name, value: i.slug })));
    } else if (focused.name === "division") {
      const divs = org.divisions.filter((d) => !init || d.initiative_slug === init);
      await interaction.respond(choices(divs, focused.value, (d) => ({ name: d.name, value: d.slug })));
    } else if (focused.name === "unit") {
      const units = org.units.filter((u) => (!init || u.initiative_slug === init) && (!div || u.division_slug === div));
      await interaction.respond(choices(units, focused.value, (u) => ({ name: u.name, value: u.name })));
    }
  },

  async execute(ctx, interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const target = interaction.options.getUser("member", true);
    const result = await rpc<{ accepted: boolean; initiative: string; rank: string | null }>(ctx.db, "bot_assign", {
      p_actor_discord: interaction.user.id,
      p_target_discord: target.id,
      p_initiative_slug: interaction.options.getString("initiative", true),
      p_division_slug: interaction.options.getString("division"),
      p_unit_name: interaction.options.getString("unit"),
      p_remove: interaction.options.getBoolean("remove") ?? false,
    });

    const sync = await syncMember(ctx, interaction.guild!, target.id, `Assigned by ${interaction.user.tag}`);
    const headline = result.accepted
      ? `Accepted <@${target.id}> into **${result.initiative}** as **${result.rank}**. Welcome aboard!`
      : `Updated <@${target.id}>'s assignment in **${result.initiative}**.`;
    await interaction.editReply([headline, describeSync(sync)].filter(Boolean).join("\n"));
  },
};
