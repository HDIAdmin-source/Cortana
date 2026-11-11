import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { rpc } from "../db";
import { notifyAdmins } from "../context";
import { choices } from "../lookups";
import { describeSync, syncMember } from "../sync/apply";
import type { PendingPromotion } from "../types";
import type { Command } from "./types";

export const promote: Command = {
  data: new SlashCommandBuilder()
    .setName("promote")
    .setDescription("Change a member's rank")
    .addSubcommand((s) =>
      s
        .setName("member")
        .setDescription("Promote (or, for Admins, demote) a member. Above your limit it becomes a proposal")
        .addUserOption((o) => o.setName("member").setDescription("Who").setRequired(true))
        .addStringOption((o) => o.setName("rank").setDescription("New rank").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("reason").setDescription("Why (kept in their rank history)").setRequired(true).setMaxLength(500)),
    )
    .addSubcommand((s) => s.setName("pending").setDescription("List promotions waiting for an Admin"))
    .addSubcommand((s) =>
      s
        .setName("decide")
        .setDescription("Admins: approve or reject a proposed promotion")
        .addStringOption((o) => o.setName("request").setDescription("Which proposal").setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName("approve").setDescription("True to approve, false to reject").setRequired(true)),
    ),

  async autocomplete(ctx, interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "rank") {
      const org = await ctx.lookups.get();
      await interaction.respond(choices(org.ranks, focused.value, (r) => ({ name: r.name, value: r.name })));
    } else if (focused.name === "request") {
      const pending = await rpc<PendingPromotion[]>(ctx.db, "bot_pending_promotions");
      await interaction.respond(
        choices(pending, focused.value, (p) => ({
          name: `${p.discord_name}: ${p.from_rank ?? "none"} → ${p.to_rank} (by ${p.proposed_by ?? "?"})`,
          value: p.id,
        })),
      );
    }
  },

  async execute(ctx, interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild!;

    if (sub === "member") {
      const target = interaction.options.getUser("member", true);
      const rank = interaction.options.getString("rank", true);
      const reason = interaction.options.getString("reason", true);
      const result = await rpc<{ result: "changed" | "proposed"; rank: string }>(ctx.db, "bot_promote", {
        p_actor_discord: interaction.user.id,
        p_target_discord: target.id,
        p_rank_name: rank,
        p_reason: reason,
      });

      if (result.result === "changed") {
        const sync = await syncMember(ctx, guild, target.id, `Rank changed to ${result.rank}`);
        await interaction.editReply([`<@${target.id}> is now **${result.rank}**.`, describeSync(sync)].filter(Boolean).join("\n"));
      } else {
        await notifyAdmins(
          ctx,
          `📋 <@${interaction.user.id}> proposes promoting <@${target.id}> to **${result.rank}**: "${reason}". Decide with \`/promote decide\`.`,
        );
        await interaction.editReply(
          `Promotion to **${result.rank}** needs an Admin's approval, so I've sent it to them as a proposal. Nothing has changed yet.`,
        );
      }
      return;
    }

    if (sub === "pending") {
      const pending = await rpc<PendingPromotion[]>(ctx.db, "bot_pending_promotions");
      await interaction.editReply(
        pending.length
          ? pending
              .map((p) => `• <@${p.discord_id}>: ${p.from_rank ?? "none"} → **${p.to_rank}**, proposed by ${p.proposed_by ?? "?"}: "${p.reason}"`)
              .join("\n")
              .slice(0, 2000)
          : "No promotions are waiting.",
      );
      return;
    }

    // decide
    const approve = interaction.options.getBoolean("approve", true);
    const result = await rpc<{ result: string; discord_id: string; rank: string }>(ctx.db, "bot_decide_promotion", {
      p_actor_discord: interaction.user.id,
      p_request_id: interaction.options.getString("request", true),
      p_approve: approve,
    });
    if (approve) {
      const sync = await syncMember(ctx, guild, result.discord_id, `Promotion to ${result.rank} approved`);
      await interaction.editReply([`Approved: <@${result.discord_id}> is now **${result.rank}**.`, describeSync(sync)].filter(Boolean).join("\n"));
    } else {
      await interaction.editReply(`Rejected the promotion of <@${result.discord_id}> to **${result.rank}**.`);
    }
  },
};
