import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { rpc, UserFacingError } from "../db";
import { choices } from "../lookups";
import type { Command } from "./types";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const TIME_ZONES = Intl.supportedValuesOf("timeZone");

export const enlist: Command = {
  data: new SlashCommandBuilder()
    .setName("enlist")
    .setDescription("Apply to join HDI")
    .addStringOption((o) =>
      o.setName("rsi_handle").setDescription("Your RSI handle (the name in your RSI profile link)").setRequired(true).setMaxLength(60),
    )
    .addStringOption((o) =>
      o.setName("timezone").setDescription("Your time zone, e.g. Europe/London").setRequired(true).setAutocomplete(true),
    )
    .addStringOption((o) =>
      o.setName("initiative").setDescription("The initiative you'd like to join").setRequired(true).setAutocomplete(true),
    ),

  async autocomplete(ctx, interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "timezone") {
      await interaction.respond(choices(TIME_ZONES, focused.value, (tz) => ({ name: tz, value: tz })));
    } else if (focused.name === "initiative") {
      const org = await ctx.lookups.get();
      await interaction.respond(
        choices(org.initiatives.filter((i) => i.is_home), focused.value, (i) => ({ name: i.name, value: i.slug })),
      );
    }
  },

  async execute(ctx, interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const handle = interaction.options.getString("rsi_handle", true).trim();
    const timezone = interaction.options.getString("timezone", true).trim();
    const initiative = interaction.options.getString("initiative", true);
    if (!isValidTimeZone(timezone)) {
      throw new UserFacingError(`"${timezone}" isn't a time zone I recognise. Pick one from the list, e.g. Europe/London.`);
    }

    const result = await rpc<{ status: string; member_status?: string; initiative?: string }>(ctx.db, "bot_enlist", {
      p_discord_id: interaction.user.id,
      p_discord_name: interaction.user.globalName ?? interaction.user.username,
      p_rsi_handle: handle,
      p_timezone: timezone,
      p_initiative_slug: initiative,
    });

    if (result.status === "exists") {
      await interaction.editReply(
        `You're already in Cortana (status: ${result.member_status}). Use \`/profile\` to see your record, or \`/verify\` if you haven't linked your RSI handle yet.`,
      );
      return;
    }

    await interaction.editReply(
      [
        `Thanks, your application to **${result.initiative}** is in. ✅`,
        "",
        "**Next step: prove you own your RSI account.** Run `/verify handle` with your RSI handle and follow the instructions.",
        "After that, a leader from the initiative will look at your application.",
      ].join("\n"),
    );

    if (ctx.env.recruitmentChannelId) {
      const channel = await ctx.client.channels.fetch(ctx.env.recruitmentChannelId).catch(() => null);
      if (channel?.isSendable()) {
        const ping = ctx.env.recruiterRoleId ? `<@&${ctx.env.recruiterRoleId}> ` : "";
        await channel.send({
          content: `${ping}New application: <@${interaction.user.id}>, RSI handle **${handle}**, wants **${result.initiative}**, time zone ${timezone}. They still need to \`/verify\`; accept them with \`/assign\` afterwards.`,
          allowedMentions: { roles: ctx.env.recruiterRoleId ? [ctx.env.recruiterRoleId] : [], users: [] },
        });
      }
    }
  },
};
