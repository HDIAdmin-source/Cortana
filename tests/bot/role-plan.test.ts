import { describe, expect, it } from "vitest";
import { isNoop, planRoles } from "../../apps/bot/src/sync/plan";

describe("role sync planning", () => {
  const managed = ["eos", "industry", "e-hoplite", "e-operator", "helios", "hdi"];

  it("adds missing Cortana roles and removes stale ones", () => {
    const plan = planRoles(["eos", "e-hoplite", "eu-region"], ["eos", "e-operator", "hdi"], managed);
    expect(plan.add.sort()).toEqual(["e-operator", "hdi"]);
    expect(plan.remove).toEqual(["e-hoplite"]);
  });

  it("never removes a role Cortana doesn't manage (region, booster, community roles)", () => {
    const plan = planRoles(["eu-region", "patreon", "event-organizer", "helios"], [], managed);
    expect(plan.remove).toEqual(["helios"]);
    expect(plan.final.sort()).toEqual(["eu-region", "event-organizer", "patreon"]);
  });

  it("does nothing when Discord already matches", () => {
    expect(isNoop(planRoles(["eos", "hdi", "eu-region"], ["eos", "hdi"], managed))).toBe(true);
  });
});
