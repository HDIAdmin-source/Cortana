import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { Ctx } from "../context";

export interface Command {
  data: SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute(ctx: Ctx, interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(ctx: Ctx, interaction: AutocompleteInteraction): Promise<void>;
}
