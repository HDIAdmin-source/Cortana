import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { Ctx } from "../context";

/** Buttons, select menus and pop-up forms are routed by the text before the first ":" in their custom ID. */
export type ComponentHandler = (ctx: Ctx, interaction: MessageComponentInteraction | ModalSubmitInteraction) => Promise<void>;

export interface Command {
  data: SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute(ctx: Ctx, interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(ctx: Ctx, interaction: AutocompleteInteraction): Promise<void>;
  components?: Record<string, ComponentHandler>;
}
