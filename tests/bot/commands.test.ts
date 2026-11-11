import { describe, expect, it } from "vitest";
import { commands, componentHandlers } from "../../apps/bot/src/commands";

describe("slash command definitions", () => {
  it("are all valid for Discord and match the spec's command list", () => {
    // toJSON() runs discord.js's validation (name format, description length, option rules).
    const names = commands.map((c) => c.data.toJSON().name);
    expect(names.sort()).toEqual(["assign", "enlist", "hangar", "op", "profile", "promote", "roster", "setup", "verify"]);
  });

  it("route every button, menu and form the op post uses", () => {
    expect([...componentHandlers.keys()].sort()).toEqual([
      "op-aar", "op-attend", "op-details", "op-role", "op-rolemodal", "op-ship", "op-signup",
    ]);
  });
});
