import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Ctx } from "../context";
import { rpc } from "../db";
import { WIKI_CREDIT } from "../wiki";
import type { Command } from "./types";

interface HangarEntry {
  id: string;
  ship: string;
  manufacturer: string | null;
  role: string | null;
  size: string | null;
  available_for_ops: boolean;
}

/** Search the ship catalogue by name (escaping the % and _ wildcards). */
async function searchShips(ctx: Ctx, typed: string) {
  const q = typed.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await ctx.db
    .from("ships")
    .select("id, name, manufacturer")
    .ilike("name", `%${q}%`)
    .order("name")
    .limit(25);
  if (error) throw new Error(error.message);
  return (data ?? []).map((s: { id: string; name: string; manufacturer: string | null }) => ({
    name: `${s.name}${s.manufacturer ? ` (${s.manufacturer})` : ""}`.slice(0, 100),
    value: s.id,
  }));
}

export const hangar: Command = {
  data: new SlashCommandBuilder()
    .setName("hangar")
    .setDescription("Your self-reported ships (private unless you offer them for ops)")
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add a ship you own")
        .addStringOption((o) => o.setName("ship").setDescription("Start typing the ship's name").setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName("available").setDescription("Offer it for ops, so Officers can see it (default: no)")),
    )
    .addSubcommand((s) =>
      s
        .setName("list")
        .setDescription("Show your hangar (Officers: ships a member offered for ops)")
        .addUserOption((o) => o.setName("member").setDescription("Whose hangar (yours if left blank)")),
    )
    .addSubcommand((s) =>
      s
        .setName("available")
        .setDescription("Offer a ship for ops, or make it private again")
        .addStringOption((o) => o.setName("ship").setDescription("One of your ships").setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName("available").setDescription("Offer it for ops?").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a ship from your hangar")
        .addStringOption((o) => o.setName("ship").setDescription("One of your ships").setRequired(true).setAutocomplete(true)),
    ),

  async autocomplete(ctx, interaction) {
    const typed = interaction.options.getFocused();
    if (interaction.options.getSubcommand() === "add") {
      await interaction.respond(await searchShips(ctx, typed));
      return;
    }
    const own = await rpc<HangarEntry[]>(ctx.db, "bot_hangar_list", {
      p_actor_discord: interaction.user.id,
      p_target_discord: interaction.user.id,
    }).catch(() => [] as HangarEntry[]);
    const q = typed.trim().toLowerCase();
    await interaction.respond(
      own
        .filter((h) => !q || h.ship.toLowerCase().includes(q))
        .slice(0, 25)
        .map((h) => ({ name: `${h.ship}${h.available_for_ops ? " (offered for ops)" : ""}`.slice(0, 100), value: h.id })),
    );
  },

  async execute(ctx, interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();

    if (sub === "add") {
      const result = await rpc<{ ship: string; available_for_ops: boolean }>(ctx.db, "bot_hangar_add", {
        p_discord_id: interaction.user.id,
        p_ship_id: interaction.options.getString("ship", true),
        p_available: interaction.options.getBoolean("available") ?? false,
      });
      await interaction.editReply(
        `Added the **${result.ship}** to your hangar${result.available_for_ops ? ", offered for ops" : " (private)"}.`,
      );
      return;
    }

    if (sub === "list") {
      const target = interaction.options.getUser("member") ?? interaction.user;
      const ships = await rpc<HangarEntry[]>(ctx.db, "bot_hangar_list", {
        p_actor_discord: interaction.user.id,
        p_target_discord: target.id,
      });
      const self = target.id === interaction.user.id;
      const embed = new EmbedBuilder()
        .setTitle(self ? "Your hangar" : `${target.displayName}'s ships offered for ops`)
        .setDescription(
          ships.length
            ? ships
                .map((s) => `**${s.ship}**${s.manufacturer ? ` · ${s.manufacturer}` : ""}${s.role ? ` · ${s.role}` : ""}${self && s.available_for_ops ? " · offered for ops" : ""}`)
                .join("\n")
                .slice(0, 4000)
            : self
              ? "Empty. Add ships with `/hangar add`."
              : "Nothing offered for ops.",
        )
        .setFooter({ text: `Member-reported, not verified with RSI · ${WIKI_CREDIT}` });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const remove = sub === "remove";
    const result = await rpc<{ ship: string; removed?: boolean; available_for_ops?: boolean }>(ctx.db, "bot_hangar_update", {
      p_discord_id: interaction.user.id,
      p_member_ship_id: interaction.options.getString("ship", true),
      p_available: remove ? false : interaction.options.getBoolean("available", true),
      p_remove: remove,
    });
    await interaction.editReply(
      result.removed
        ? `Removed the **${result.ship}** from your hangar.`
        : `The **${result.ship}** is now ${result.available_for_ops ? "offered for ops" : "private"}.`,
    );
  },
};
