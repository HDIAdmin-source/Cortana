import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { rpc } from "../db";
import type { Profile } from "../types";
import type { Command } from "./types";

export const profile: Command = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Show a member's rank, initiative, divisions, appointments and awards")
    .addUserOption((o) => o.setName("member").setDescription("Who to show (yourself if left blank)")),

  async execute(ctx, interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const target = interaction.options.getUser("member") ?? interaction.user;
    const p = await rpc<Profile | null>(ctx.db, "bot_profile", {
      p_actor_discord: interaction.user.id,
      p_target_discord: target.id,
    });
    if (!p) {
      await interaction.editReply(
        target.id === interaction.user.id ? "You're not in Cortana yet. Run `/enlist` to apply." : `<@${target.id}> isn't in Cortana yet.`,
      );
      return;
    }

    const home = p.assignments.find((a) => a.primary);
    const aux = p.assignments.filter((a) => !a.primary);
    const place = (a: Profile["assignments"][number]) => [a.initiative, a.division, a.unit].filter(Boolean).join(" / ");

    const embed = new EmbedBuilder()
      .setTitle(p.discord_name)
      .setDescription(`<@${p.discord_id}>`)
      .addFields(
        { name: "Rank", value: p.rank ?? "None", inline: true },
        { name: "Status", value: p.status, inline: true },
        { name: "RSI handle", value: p.rsi_handle ? `${p.rsi_handle}${p.verified ? " ✅" : " (not verified)"}` : "Not linked", inline: true },
        { name: "Home initiative", value: home ? place(home) : "None yet" },
      );
    if (aux.length) embed.addFields({ name: "Auxiliary", value: aux.map(place).join("\n") });
    if (p.appointments.length) {
      embed.addFields({
        name: "Appointments",
        value: p.appointments.map((a) => `${a.title}${a.scope ? ` (${a.scope})` : ""}`).join("\n"),
      });
    }
    if (p.awards.length) embed.addFields({ name: "Awards", value: p.awards.map((a) => a.name).join("\n") });
    if (p.timezone) embed.setFooter({ text: `Time zone: ${p.timezone}` });

    await interaction.editReply({ embeds: [embed] });
  },
};
