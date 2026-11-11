import { Client, Events, GatewayIntentBits } from "discord.js";
import { createClient } from "@supabase/supabase-js";
import type { Initiative } from "@cortana/shared";

/**
 * Phase 1: the bot only logs in and confirms it can reach the database.
 * Slash commands (/enlist, /verify, /promote...) arrive in Phase 2.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy apps/bot/.env.example to apps/bot/.env and fill it in (see the README).`);
    process.exit(1);
  }
  return value;
}

const token = requireEnv("DISCORD_TOKEN");
const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
  console.log(`Cortana bot logged in as ${ready.user.tag}`);

  const { data, error } = await supabase
    .from("initiatives")
    .select("name")
    .order("sort_order")
    .returns<Pick<Initiative, "name">[]>();

  if (error) {
    console.error("Could not reach the Cortana database:", error.message);
  } else {
    console.log(`Database OK. Initiatives: ${data.map((i) => i.name).join(", ")}`);
  }
});

await client.login(token);
