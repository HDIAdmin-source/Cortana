import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from "discord.js";
import { commandsByName } from "./commands";
import type { Ctx } from "./context";
import { createDb, UserFacingError } from "./db";
import { loadEnv } from "./env";
import { createLookups } from "./lookups";
import { onMemberUpdate } from "./sync/mismatch";

/**
 * The Cortana Discord bot (docs/SPEC.md, "Discord bot, version 1").
 * Cortana is the source of truth; Discord roles mirror it, never the other way round.
 */
const env = loadEnv();
const db = createDb(env.supabaseUrl, env.serviceRoleKey);

const client = new Client({
  // GuildMembers is a "privileged intent": switch on "Server Members Intent" in the
  // Discord Developer Portal (Bot page), or login fails. It's needed to notice roles
  // handed out by hand.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const ctx: Ctx = { client, db, env, lookups: createLookups(db) };

client.once(Events.ClientReady, async (ready) => {
  console.log(`Cortana bot logged in as ${ready.user.tag}`);
  try {
    const org = await ctx.lookups.get();
    console.log(`Database OK. Initiatives: ${org.initiatives.map((i) => i.name).join(", ")}`);
  } catch (err) {
    console.error("Could not reach the Cortana database:", err);
  }
  if (!ready.guilds.cache.has(env.guildId)) {
    console.warn(`The bot isn't in the server ${env.guildId} (DISCORD_GUILD_ID). Invite it first; see the README.`);
  }
});

async function reply(interaction: Interaction, content: string) {
  if (!interaction.isRepliable()) return;
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content, embeds: [] }).catch(() => undefined);
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  // Only work in the configured server (the test server until the owner approves going live).
  if (interaction.guildId !== env.guildId) {
    if (interaction.isRepliable()) await reply(interaction, "Cortana only works in the HDI server.");
    return;
  }

  if (interaction.isAutocomplete()) {
    const command = commandsByName.get(interaction.commandName);
    try {
      await command?.autocomplete?.(ctx, interaction);
    } catch (err) {
      console.error(`Autocomplete for /${interaction.commandName} failed:`, err);
      await interaction.respond([]).catch(() => undefined);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = commandsByName.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(ctx, interaction);
  } catch (err) {
    if (err instanceof UserFacingError) {
      await reply(interaction, err.message);
    } else {
      console.error(`/${interaction.commandName} failed:`, err);
      await reply(interaction, "Something went wrong on my side, and an admin can see the details in the bot's logs. Nothing was changed unless I said so.");
    }
  }
});

client.on(Events.GuildMemberUpdate, (before, after) => {
  onMemberUpdate(ctx, before, after).catch((err) => console.error("Role mismatch check failed:", err));
});

await client.login(env.token);
