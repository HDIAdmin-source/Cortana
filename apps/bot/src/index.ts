import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from "discord.js";
import { commandsByName, componentHandlers } from "./commands";
import { syncShips } from "./wiki";
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

  // First run: fill the ship list from the Star Citizen Wiki so /hangar add has ships to offer.
  const { count, error } = await db.from("ships").select("id", { count: "exact", head: true });
  if (!error && count === 0) {
    syncShips(db)
      .then((n) => console.log(`Loaded ${n} ships from the Star Citizen Wiki.`))
      .catch((err) => console.error("Couldn't load ships from the Star Citizen Wiki (try /setup ships later):", err));
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

  let label: string;
  let run: () => Promise<void>;
  if (interaction.isChatInputCommand()) {
    const command = commandsByName.get(interaction.commandName);
    if (!command) return;
    label = `/${interaction.commandName}`;
    run = () => command.execute(ctx, interaction);
  } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
    const prefix = interaction.customId.split(":")[0]!;
    const handler = componentHandlers.get(prefix);
    if (!handler) return;
    label = `component ${prefix}`;
    run = () => handler(ctx, interaction);
  } else {
    return;
  }

  try {
    await run();
  } catch (err) {
    if (err instanceof UserFacingError) {
      await reply(interaction, err.message);
    } else {
      console.error(`${label} failed:`, err);
      await reply(interaction, "Something went wrong on my side, and an admin can see the details in the bot's logs. Nothing was changed unless I said so.");
    }
  }
});

client.on(Events.GuildMemberUpdate, (before, after) => {
  onMemberUpdate(ctx, before, after).catch((err) => console.error("Role mismatch check failed:", err));
});

try {
  await client.login(env.token);
} catch (err) {
  const message = (err as Error).message ?? String(err);
  if (/disallowed intents/i.test(message)) {
    console.error(
      "\nDiscord refused to connect: \"Server Members Intent\" is switched off.\n" +
        "Fix: Discord Developer Portal > your application > Bot > Privileged Gateway Intents >\n" +
        "turn on SERVER MEMBERS INTENT > Save Changes. Then start the bot again.\n",
    );
  } else if (/invalid token|TokenInvalid/i.test(message)) {
    console.error(
      "\nDiscord says the bot token is wrong.\n" +
        "Fix: Developer Portal > Bot > Reset Token, paste the new token into DISCORD_TOKEN in apps/bot/.env, start again.\n",
    );
  } else {
    console.error("Couldn't log in to Discord:", err);
  }
  process.exit(1);
}
