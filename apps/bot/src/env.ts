export interface BotEnv {
  token: string;
  clientId: string;
  guildId: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  adminChannelId?: string;
  recruitmentChannelId?: string;
  recruiterRoleId?: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. Copy apps/bot/.env.example to apps/bot/.env and fill it in (see the README).`);
    process.exit(1);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function loadEnv(): BotEnv {
  return {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    guildId: required("DISCORD_GUILD_ID"),
    supabaseUrl: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    adminChannelId: optional("ADMIN_CHANNEL_ID"),
    recruitmentChannelId: optional("RECRUITMENT_CHANNEL_ID"),
    recruiterRoleId: optional("RECRUITER_ROLE_ID"),
  };
}
