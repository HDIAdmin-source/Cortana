import { REST, Routes } from "discord.js";
import { commands } from "./commands";

/**
 * Tells Discord about the slash commands. Run it once, and again whenever a command's
 * name or options change:  pnpm --filter @cortana/bot register
 * Commands are registered to one server (DISCORD_GUILD_ID), so they appear instantly.
 */
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !clientId || !guildId) {
  console.error("Set DISCORD_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID in apps/bot/.env first.");
  process.exit(1);
}

const rest = new REST().setToken(token);
const body = commands.map((c) => c.data.toJSON());
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
console.log(`Registered ${body.length} commands: ${body.map((c) => `/${c.name}`).join(", ")}`);
