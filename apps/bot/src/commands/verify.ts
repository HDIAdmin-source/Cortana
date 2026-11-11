import { randomInt } from "node:crypto";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import { rpc, UserFacingError } from "../db";
import { checkBio, checkOrgMembership, newVerificationCode } from "../rsi";
import { describeSync, syncMember } from "../sync/apply";
import type { PendingVerification } from "../types";
import type { Command } from "./types";

const NOTHING_CHANGED = "Nothing about your membership or roles has changed.";

export const verify: Command = {
  data: new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Link and prove your RSI handle")
    .addSubcommand((s) =>
      s
        .setName("handle")
        .setDescription("Get a one-time code to put in your RSI bio")
        .addStringOption((o) => o.setName("rsi_handle").setDescription("Your RSI handle").setRequired(true).setMaxLength(60)),
    )
    .addSubcommand((s) => s.setName("check").setDescription("Check your RSI bio for the code"))
    .addSubcommand((s) =>
      s
        .setName("manual")
        .setDescription("Admins: verify someone the automatic check can't")
        .addUserOption((o) => o.setName("member").setDescription("Who to verify").setRequired(true))
        .addStringOption((o) => o.setName("rsi_handle").setDescription("Their RSI handle").setRequired(true).setMaxLength(60)),
    ),

  async execute(ctx, interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild!;

    if (sub === "handle") {
      const handle = interaction.options.getString("rsi_handle", true).trim();
      const code = newVerificationCode(randomInt);
      await rpc(ctx.db, "bot_start_verification", {
        p_discord_id: interaction.user.id,
        p_rsi_handle: handle,
        p_code: code,
      });
      await interaction.editReply(
        [
          `Your one-time code is **\`${code}\`** (valid for 24 hours).`,
          "",
          `1. Open https://robertsspaceindustries.com/account/profile and sign in as **${handle}**.`,
          `2. Paste \`${code}\` anywhere in your **Short Bio** and save.`,
          "3. Come back and run `/verify check`.",
          "",
          "Once you're verified you can delete the code from your bio.",
        ].join("\n"),
      );
      return;
    }

    if (sub === "check") {
      const pending = await rpc<PendingVerification | null>(ctx.db, "bot_pending_verification", {
        p_discord_id: interaction.user.id,
      });
      if (!pending) {
        throw new UserFacingError("You don't have a code waiting. Run `/verify handle` first.");
      }

      const org = await ctx.lookups.get();
      if (!org.rsiOrgSid) throw new Error("org_settings.rsi_org_sid is not set");

      const bio = await checkBio(pending.rsi_handle, pending.code);
      if (bio.kind === "error") {
        console.warn("RSI bio check failed:", bio.reason);
        throw new UserFacingError(`I couldn't read RSI right now. ${NOTHING_CHANGED} Please try again in a few minutes.`);
      }
      if (bio.kind === "no_such_citizen") {
        throw new UserFacingError(
          `RSI has no citizen called **${pending.rsi_handle}**. Check the spelling and run \`/verify handle\` again.`,
        );
      }
      if (bio.kind === "code_missing") {
        throw new UserFacingError(
          `I can't see \`${pending.code}\` in **${pending.rsi_handle}**'s RSI bio yet. Save it in your Short Bio, wait a minute, then run \`/verify check\` again.`,
        );
      }

      const membership = await checkOrgMembership(org.rsiOrgSid, pending.rsi_handle);
      if (membership.kind === "error") {
        console.warn("RSI org check failed:", membership.reason);
        throw new UserFacingError(`I couldn't read HDI's RSI member list right now. ${NOTHING_CHANGED} Please try again in a few minutes.`);
      }
      if (membership.kind === "not_listed") {
        throw new UserFacingError(
          [
            `I found your code ✅, but **${pending.rsi_handle}** isn't in HDI's public RSI member list.`,
            "If you haven't joined the org on RSI yet, apply there first. If your org membership is hidden on RSI, ask an Admin to verify you by hand.",
            NOTHING_CHANGED,
          ].join(" "),
        );
      }

      const done = await rpc<{ rsi_handle: string; status: string }>(ctx.db, "bot_complete_verification", {
        p_discord_id: interaction.user.id,
        p_code_id: pending.code_id,
      });
      const sync = await syncMember(ctx, guild, interaction.user.id, "RSI handle verified");
      await interaction.editReply(
        [
          `Verified! **${done.rsi_handle}** is now linked to your Discord account. You can remove the code from your RSI bio.`,
          done.status === "applicant" ? "A leader will review your application and accept you with `/assign`." : "",
          describeSync(sync),
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return;
    }

    // manual
    const target = interaction.options.getUser("member", true);
    const handle = interaction.options.getString("rsi_handle", true).trim();
    await rpc(ctx.db, "bot_manual_verify", {
      p_actor_discord: interaction.user.id,
      p_target_discord: target.id,
      p_rsi_handle: handle,
    });
    const sync = await syncMember(ctx, guild, target.id, "RSI handle verified by an Admin");
    await interaction.editReply([`Verified <@${target.id}> as **${handle}**.`, describeSync(sync)].filter(Boolean).join("\n"));
  },
};
