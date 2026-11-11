import { assign } from "./assign";
import { enlist } from "./enlist";
import { profile } from "./profile";
import { promote } from "./promote";
import { roster } from "./roster";
import { setup } from "./setup";
import { verify } from "./verify";
import type { Command } from "./types";

export const commands: Command[] = [setup, enlist, verify, profile, roster, assign, promote];
export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));
