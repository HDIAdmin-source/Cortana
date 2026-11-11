import { assign } from "./assign";
import { enlist } from "./enlist";
import { hangar } from "./hangar";
import { op } from "./op";
import { profile } from "./profile";
import { promote } from "./promote";
import { roster } from "./roster";
import { setup } from "./setup";
import { verify } from "./verify";
import type { Command, ComponentHandler } from "./types";

export const commands: Command[] = [setup, enlist, verify, profile, roster, assign, promote, op, hangar];
export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));

/** Button / menu / form handlers, by the custom-ID prefix before the first ":". */
export const componentHandlers = new Map<string, ComponentHandler>(
  commands.flatMap((c) => Object.entries(c.components ?? {})),
);
