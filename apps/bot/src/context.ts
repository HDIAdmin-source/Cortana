import type { Client } from "discord.js";
import type { Db } from "./db";
import type { BotEnv } from "./env";
import type { Lookups } from "./lookups";

/** Everything a command needs. */
export interface Ctx {
  client: Client;
  db: Db;
  env: BotEnv;
  lookups: Lookups;
}

/** Post a message to the admin channel (if configured). Never pings anyone. */
export async function notifyAdmins(ctx: Ctx, content: string): Promise<void> {
  if (!ctx.env.adminChannelId) return;
  try {
    const channel = await ctx.client.channels.fetch(ctx.env.adminChannelId);
    if (channel?.isSendable()) {
      await channel.send({ content: content.slice(0, 2000), allowedMentions: { parse: [] } });
    }
  } catch (err) {
    console.error("Could not post to the admin channel:", err);
  }
}
