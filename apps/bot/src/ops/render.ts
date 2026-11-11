import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { discordTime } from "./time";

export interface OpSignup {
  discord_id: string;
  name: string;
  status: "going" | "maybe" | "declined" | "attended";
  role: string | null;
  ship: string | null;
}

export interface OpSummary {
  id: string;
  name: string;
  objective: string | null;
  starts_at: string;
  staging: string | null;
  comms_channel: string | null;
  status: "planned" | "live" | "completed" | "cancelled";
  after_action: string | null;
  is_public: boolean;
  initiative: string | null;
  commander_discord_id: string | null;
  channel_id: string | null;
  message_id: string | null;
  signups: OpSignup[];
}

const STATUS_COLOUR: Record<OpSummary["status"], number> = {
  planned: 0x3b82f6,
  live: 0x22c55e,
  completed: 0x94a3b8,
  cancelled: 0xef4444,
};

const STATUS_LABEL: Record<OpSummary["status"], string> = {
  planned: "Planned",
  live: "Under way",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Custom IDs for the sign-up buttons. The op ID rides along so the bot knows which op. */
export const ids = {
  signup: (status: "going" | "maybe" | "declined", opId: string) => `op-signup:${status}:${opId}`,
  details: (opId: string) => `op-details:${opId}`,
};

/** A Discord field value is limited to 1024 characters. */
function listField(lines: string[]): string {
  if (!lines.length) return "Nobody yet";
  const out: string[] = [];
  let length = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const more = `…and ${lines.length - i} more`;
    if (length + line.length + 1 + more.length > 1000) {
      out.push(more);
      break;
    }
    out.push(line);
    length += line.length + 1;
  }
  return out.join("\n");
}

const describeSignup = (s: OpSignup) => [s.name, s.ship, s.role].filter(Boolean).join(" · ");
const isOpen = (op: OpSummary) => op.status === "planned" || op.status === "live";

/** The op's post: an embed with who's coming, plus sign-up buttons while it's open. */
export function renderOp(op: OpSummary) {
  const by = (status: OpSignup["status"]) => op.signups.filter((s) => s.status === status);
  const going = by("going");
  const maybe = by("maybe");
  const attended = by("attended");

  const embed = new EmbedBuilder()
    .setTitle(op.status === "cancelled" ? `~~${op.name}~~ (cancelled)` : op.name)
    .setColor(STATUS_COLOUR[op.status])
    .addFields(
      { name: "When", value: `${discordTime(op.starts_at, "F")} (${discordTime(op.starts_at, "R")})` },
      { name: "Status", value: STATUS_LABEL[op.status], inline: true },
    );
  if (op.objective) embed.setDescription(op.objective.slice(0, 4000));
  if (op.initiative) embed.addFields({ name: "Lead initiative", value: op.initiative, inline: true });
  if (op.commander_discord_id) embed.addFields({ name: "Commander", value: `<@${op.commander_discord_id}>`, inline: true });
  if (op.staging) embed.addFields({ name: "Staging", value: op.staging.slice(0, 1024), inline: true });
  if (op.comms_channel) {
    embed.addFields({ name: "Comms", value: /^\d+$/.test(op.comms_channel) ? `<#${op.comms_channel}>` : op.comms_channel, inline: true });
  }

  if (op.status === "completed" || attended.length) {
    embed.addFields({ name: `Attended (${attended.length})`, value: listField(attended.map(describeSignup)) });
  }
  if (isOpen(op)) {
    embed.addFields(
      { name: `Going (${going.length})`, value: listField(going.map(describeSignup)) },
      { name: `Maybe (${maybe.length})`, value: listField(maybe.map(describeSignup)) },
    );
  }
  if (op.after_action) embed.addFields({ name: "After-action report", value: op.after_action.slice(0, 1024) });
  embed.setFooter({ text: `Times are shown in your own time zone · Op ${op.id.slice(0, 8)}` });

  const components = isOpen(op)
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(ids.signup("going", op.id)).setLabel("Going").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(ids.signup("maybe", op.id)).setLabel("Maybe").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(ids.signup("declined", op.id)).setLabel("Can't make it").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(ids.details(op.id)).setLabel("My ship & role").setStyle(ButtonStyle.Primary),
        ),
      ]
    : [];

  return { embeds: [embed], components };
}
