import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { Ctx } from "../context";
import { rpc, UserFacingError } from "../db";
import { choices } from "../lookups";
import { refreshOpMessage } from "../ops/refresh";
import { renderOp, type OpSummary } from "../ops/render";
import { discordTime, formatUtc, parseUtc } from "../ops/time";
import type { WhoAmI } from "../types";
import type { Command } from "./types";

interface RecentOp {
  id: string;
  name: string;
  starts_at: string;
  status: string;
}

interface HangarEntry {
  id: string;
  ship: string;
  manufacturer: string | null;
  available_for_ops: boolean;
}

async function requireOfficer(ctx: Ctx, discordId: string) {
  const me = await rpc<WhoAmI>(ctx.db, "bot_whoami", { p_discord_id: discordId });
  if (!me.is_officer) throw new UserFacingError("Only Officers (Praetor and above) and Admins can run operations.");
}

/** The ephemeral "which ship, what role" panel shown after signing up. */
async function shipAndRolePanel(ctx: Ctx, discordId: string, opId: string, headline: string) {
  const hangar = await rpc<HangarEntry[]>(ctx.db, "bot_hangar_list", {
    p_actor_discord: discordId,
    p_target_discord: discordId,
  }).catch(() => [] as HangarEntry[]);

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
  if (hangar.length) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`op-ship:${opId}`)
          .setPlaceholder("Which ship are you bringing? (optional)")
          .addOptions(
            { label: "No ship / on foot / crewing someone else's", value: "none" },
            ...hangar.slice(0, 24).map((h) => ({
              label: h.ship.slice(0, 100),
              description: (h.manufacturer ?? "").slice(0, 100) || undefined,
              value: h.id,
            })),
          ),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`op-role:${opId}`).setLabel("Set my role").setStyle(ButtonStyle.Secondary),
    ),
  );

  const hint = hangar.length ? "" : "\nTip: add your ships with `/hangar add` to pick one here.";
  return { content: `${headline}${hint}`, components: rows };
}

function opIdFrom(customId: string): string {
  return customId.split(":").at(-1)!;
}

async function opAutocomplete(ctx: Ctx, typed: string) {
  const ops = await rpc<RecentOp[]>(ctx.db, "bot_ops_recent");
  return choices(ops, typed, (o) => ({ name: `${o.name} · ${formatUtc(o.starts_at)} · ${o.status}`, value: o.id }));
}

async function create(ctx: Ctx, interaction: ChatInputCommandInteraction) {
  const startText = interaction.options.getString("start", true);
  const startsAt = parseUtc(startText);
  if (!startsAt) {
    throw new UserFacingError(`I couldn't read "${startText}". Use UTC in the form \`2026-11-20 19:00\`.`);
  }
  const channel = interaction.channel;
  if (!channel?.isSendable()) throw new UserFacingError("I can't post in this channel. Run `/op create` in a text channel I can see.");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { id } = await rpc<{ id: string }>(ctx.db, "bot_op_create", {
    p_actor_discord: interaction.user.id,
    p_name: interaction.options.getString("name", true),
    p_starts_at: startsAt.toISOString(),
    p_objective: interaction.options.getString("objective"),
    p_initiative_slug: interaction.options.getString("initiative"),
    p_staging: interaction.options.getString("staging"),
    p_comms_channel: interaction.options.getChannel("comms")?.id ?? null,
  });

  const op = await rpc<OpSummary>(ctx.db, "bot_op_summary", { p_op_id: id });
  const message = await channel.send(renderOp(op));
  await rpc(ctx.db, "bot_op_set_message", { p_op_id: id, p_channel_id: message.channelId, p_message_id: message.id });

  await interaction.editReply(
    `Posted **${op.name}** for ${formatUtc(startsAt)}, which is ${discordTime(startsAt, "F")} in your time zone. If that's wrong, cancel it with \`/op cancel\` and post it again.`,
  );
}

async function attend(ctx: Ctx, interaction: ChatInputCommandInteraction) {
  await requireOfficer(ctx, interaction.user.id);
  const opId = interaction.options.getString("op", true);
  const remove = interaction.options.getBoolean("remove") ?? false;
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: remove
      ? "Pick who to **un-mark** as attended:"
      : "Pick who **attended** (up to 25 at a time; run `/op attend` again for more). People who didn't sign up count too.",
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`op-attend:${remove ? 0 : 1}:${opId}`)
          .setPlaceholder(remove ? "Un-mark attendance" : "Mark attendance")
          .setMinValues(1)
          .setMaxValues(25),
      ),
    ],
  });
}

async function aar(ctx: Ctx, interaction: ChatInputCommandInteraction) {
  await requireOfficer(ctx, interaction.user.id);
  const opId = interaction.options.getString("op", true);
  const isPublic = interaction.options.getBoolean("public") ?? false;
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`op-aar:${isPublic ? 1 : 0}:${opId}`)
      .setTitle("After-action report")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("summary")
            .setLabel("What happened? Outcome, losses, lessons")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(4000)
            .setRequired(true),
        ),
      ),
  );
}

async function cancel(ctx: Ctx, interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const opId = interaction.options.getString("op", true);
  await rpc(ctx.db, "bot_op_cancel", { p_actor_discord: interaction.user.id, p_op_id: opId });
  const op = await refreshOpMessage(ctx, opId);
  await interaction.editReply(`Cancelled **${op?.name ?? "the operation"}**. Its post now shows it as cancelled.`);
}

// ---------------------------------------------------------------------------
// Buttons, menus and forms
// ---------------------------------------------------------------------------

async function onSignupButton(ctx: Ctx, interaction: MessageComponentInteraction | ModalSubmitInteraction) {
  if (!interaction.isButton()) return;
  const [, status, opId] = interaction.customId.split(":") as [string, "going" | "maybe" | "declined", string];
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await rpc(ctx.db, "bot_op_signup", { p_discord_id: interaction.user.id, p_op_id: opId, p_status: status });
  await refreshOpMessage(ctx, opId);
  if (status === "declined") {
    await interaction.editReply("Got it, you're down as **can't make it**.");
    return;
  }
  await interaction.editReply(
    await shipAndRolePanel(ctx, interaction.user.id, opId, `You're down as **${status === "going" ? "Going" : "Maybe"}**. ✅`),
  );
}

async function onDetailsButton(ctx: Ctx, interaction: MessageComponentInteraction | ModalSubmitInteraction) {
  if (!interaction.isButton()) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(
    await shipAndRolePanel(ctx, interaction.user.id, opIdFrom(interaction.customId), "Choose your ship and role for this op:"),
  );
}

async function onShipSelect(ctx: Ctx, interaction: MessageComponentInteraction | ModalSubmitInteraction) {
  if (!interaction.isStringSelectMenu()) return;
  const opId = opIdFrom(interaction.customId);
  const choice = interaction.values[0];
  await interaction.deferUpdate();
  const result = await rpc<{ ship: string | null }>(ctx.db, "bot_op_set_ship", {
    p_discord_id: interaction.user.id,
    p_op_id: opId,
    p_member_ship_id: choice === "none" ? null : choice,
  });
  await refreshOpMessage(ctx, opId);
  await interaction.editReply({ content: result.ship ? `Bringing the **${result.ship}**. ✅` : "No ship. ✅", components: [] });
}

async function onRoleButton(ctx: Ctx, interaction: MessageComponentInteraction | ModalSubmitInteraction) {
  if (!interaction.isButton()) return;
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`op-rolemodal:${opIdFrom(interaction.customId)}`)
      .setTitle("Your role on this op")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("role")
            .setLabel("e.g. Pilot, Gunner, Medic, Engineer")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(60)
            .setRequired(false),
        ),
      ),
  );
}

async function onRoleModal(ctx: Ctx, interaction: MessageComponentInteraction | ModalSubmitInteraction) {
  if (!interaction.isModalSubmit()) return;
  const opId = opIdFrom(interaction.customId);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await rpc<{ role: string | null }>(ctx.db, "bot_op_set_role", {
    p_discord_id: interaction.user.id,
    p_op_id: opId,
    p_role: interaction.fields.getTextInputValue("role"),
  });
  await refreshOpMessage(ctx, opId);
  await interaction.editReply(result.role ? `Role set to **${result.role}**. ✅` : "Role cleared. ✅");
}

async function onAttendSelect(ctx: Ctx, interaction: MessageComponentInteraction | ModalSubmitInteraction) {
  if (!interaction.isUserSelectMenu()) return;
  const [, mark, opId] = interaction.customId.split(":") as [string, string, string];
  await interaction.deferUpdate();
  const result = await rpc<{ changed: number; unknown: string[]; attended_total: number }>(ctx.db, "bot_op_attend", {
    p_actor_discord: interaction.user.id,
    p_op_id: opId,
    p_discord_ids: interaction.values,
    p_attended: mark === "1",
  });
  await refreshOpMessage(ctx, opId);
  const unknown = result.unknown.length
    ? `\nNot recorded (not active members in Cortana): ${result.unknown.map((id) => `<@${id}>`).join(", ")}`
    : "";
  await interaction.editReply({
    content: `${mark === "1" ? "Marked" : "Un-marked"} ${result.changed}. **${result.attended_total}** attended in total.${unknown}`,
    components: [],
    allowedMentions: { parse: [] },
  });
}

async function onAarModal(ctx: Ctx, interaction: MessageComponentInteraction | ModalSubmitInteraction) {
  if (!interaction.isModalSubmit()) return;
  const [, isPublic, opId] = interaction.customId.split(":") as [string, string, string];
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await rpc<{ attended: number }>(ctx.db, "bot_op_aar", {
    p_actor_discord: interaction.user.id,
    p_op_id: opId,
    p_summary: interaction.fields.getTextInputValue("summary"),
    p_public: isPublic === "1",
  });
  const op = await refreshOpMessage(ctx, opId);
  await interaction.editReply(
    `After-action report saved and **${op?.name ?? "the operation"}** marked completed (${result.attended} attended).` +
      (isPublic === "1" ? " It will be shown on the public website." : " It stays members-only."),
  );
}

export const op: Command = {
  data: new SlashCommandBuilder()
    .setName("op")
    .setDescription("Operations: create, take attendance, after-action report")
    .addSubcommand((s) =>
      s
        .setName("create")
        .setDescription("Officers: post an operation with sign-up buttons in this channel")
        .addStringOption((o) => o.setName("name").setDescription("Operation name").setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName("start").setDescription("Start time in UTC, e.g. 2026-11-20 19:00").setRequired(true))
        .addStringOption((o) => o.setName("objective").setDescription("What's the goal?").setMaxLength(1000))
        .addStringOption((o) => o.setName("initiative").setDescription("Lead initiative").setAutocomplete(true))
        .addStringOption((o) => o.setName("staging").setDescription("Where to meet in game").setMaxLength(200))
        .addChannelOption((o) =>
          o.setName("comms").setDescription("Voice channel for the op").addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("attend")
        .setDescription("Officers: mark who attended")
        .addStringOption((o) => o.setName("op").setDescription("Operation").setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName("remove").setDescription("Un-mark people instead")),
    )
    .addSubcommand((s) =>
      s
        .setName("aar")
        .setDescription("Officers: write the after-action report and close the op")
        .addStringOption((o) => o.setName("op").setDescription("Operation").setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName("public").setDescription("Show this report on the public website (default: no)")),
    )
    .addSubcommand((s) =>
      s
        .setName("cancel")
        .setDescription("Officers: cancel an operation")
        .addStringOption((o) => o.setName("op").setDescription("Operation").setRequired(true).setAutocomplete(true)),
    ),

  async autocomplete(ctx, interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "initiative") {
      const org = await ctx.lookups.get();
      await interaction.respond(choices(org.initiatives, focused.value, (i) => ({ name: i.name, value: i.slug })));
    } else if (focused.name === "op") {
      await interaction.respond(await opAutocomplete(ctx, focused.value));
    }
  },

  async execute(ctx, interaction) {
    switch (interaction.options.getSubcommand()) {
      case "create":
        return create(ctx, interaction);
      case "attend":
        return attend(ctx, interaction);
      case "aar":
        return aar(ctx, interaction);
      case "cancel":
        return cancel(ctx, interaction);
    }
  },

  components: {
    "op-signup": onSignupButton,
    "op-details": onDetailsButton,
    "op-ship": onShipSelect,
    "op-role": onRoleButton,
    "op-rolemodal": onRoleModal,
    "op-attend": onAttendSelect,
    "op-aar": onAarModal,
  },
};
