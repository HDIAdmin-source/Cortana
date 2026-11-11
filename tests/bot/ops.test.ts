import { describe, expect, it } from "vitest";
import { renderOp, type OpSummary } from "../../apps/bot/src/ops/render";
import { discordTime, formatUtc, parseUtc } from "../../apps/bot/src/ops/time";

describe("UTC start times", () => {
  it("reads '2026-11-20 19:00' as UTC, with or without 'UTC'", () => {
    expect(parseUtc("2026-11-20 19:00")?.toISOString()).toBe("2026-11-20T19:00:00.000Z");
    expect(parseUtc(" 2026-11-20T07:05 UTC ")?.toISOString()).toBe("2026-11-20T07:05:00.000Z");
  });

  it("rejects anything ambiguous or impossible", () => {
    for (const bad of ["20/11/2026 19:00", "tomorrow 7pm", "2026-02-31 10:00", "2026-11-20 25:00", "2026-11-20"]) {
      expect(parseUtc(bad)).toBeNull();
    }
  });

  it("shows members their own local time through Discord timestamps", () => {
    expect(discordTime("2026-11-20T19:00:00Z", "F")).toBe("<t:1795201200:F>");
    expect(formatUtc("2026-11-20T19:00:00Z")).toBe("2026-11-20 19:00 UTC");
  });
});

const baseOp: OpSummary = {
  id: "0b2f1c9e-0000-4000-8000-000000000000",
  name: "Operation Daybreak",
  objective: "Escort the haulers",
  starts_at: "2026-11-20T19:00:00Z",
  staging: "Port Olisar",
  comms_channel: "123456789012345678",
  status: "planned",
  after_action: null,
  is_public: false,
  initiative: "Helios",
  commander_discord_id: "111",
  channel_id: null,
  message_id: null,
  signups: [
    { discord_id: "1", name: "Alpha", status: "going", role: "Pilot", ship: "Cutlass Black" },
    { discord_id: "2", name: "Bravo", status: "maybe", role: null, ship: null },
    { discord_id: "3", name: "Charlie", status: "declined", role: null, ship: null },
  ],
};

describe("the op post", () => {
  it("shows the time as a Discord timestamp, who's coming, and four buttons", () => {
    const { embeds, components } = renderOp(baseOp);
    const json = embeds[0]!.toJSON();
    const field = (name: string) => json.fields?.find((f) => f.name.startsWith(name))?.value;

    expect(field("When")).toBe("<t:1795201200:F> (<t:1795201200:R>)");
    expect(field("Going (1)")).toBe("Alpha · Cutlass Black · Pilot");
    expect(field("Maybe (1)")).toBe("Bravo");
    expect(field("Comms")).toBe("<#123456789012345678>");
    expect(JSON.stringify(json)).not.toContain("Charlie"); // declined people aren't listed

    const buttons = components[0]!.toJSON().components.map((b) => ("custom_id" in b ? b.custom_id : ""));
    expect(buttons).toEqual([
      `op-signup:going:${baseOp.id}`,
      `op-signup:maybe:${baseOp.id}`,
      `op-signup:declined:${baseOp.id}`,
      `op-details:${baseOp.id}`,
    ]);
  });

  it("drops the buttons and shows attendance and the report once completed", () => {
    const done: OpSummary = {
      ...baseOp,
      status: "completed",
      after_action: "Convoy delivered.",
      signups: [{ discord_id: "1", name: "Alpha", status: "attended", role: null, ship: null }],
    };
    const { embeds, components } = renderOp(done);
    const json = embeds[0]!.toJSON();
    expect(components).toEqual([]);
    expect(json.fields?.find((f) => f.name === "Attended (1)")?.value).toBe("Alpha");
    expect(json.fields?.find((f) => f.name === "After-action report")?.value).toBe("Convoy delivered.");
  });

  it("stays within Discord's limits for a big op", () => {
    const signups = Array.from({ length: 300 }, (_, i) => ({
      discord_id: String(i), name: `Pilot number ${i}`, status: "going" as const, role: "Gunner", ship: "Idris-P",
    }));
    const json = renderOp({ ...baseOp, signups }).embeds[0]!.toJSON();
    const going = json.fields?.find((f) => f.name === "Going (300)")!.value ?? "";
    expect(going.length).toBeLessThanOrEqual(1024);
    expect(going).toMatch(/…and \d+ more$/);
  });
});
