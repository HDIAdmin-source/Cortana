import { describe, expect, it } from "vitest";
import { fitMessage } from "../../apps/bot/src/commands/setup";

describe("/setup roles reply", () => {
  it("fits Discord's 2000-character limit and says how many lines were left out", () => {
    const lines = Array.from({ length: 80 }, (_, i) => `• Rank: Something (Initiative ${i}): "X-Something-${i}"`);
    const text = fitMessage(lines);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text).toMatch(/…and \d+ more\.$/);
  });

  it("leaves a short reply alone", () => {
    expect(fitMessage(["Linked 3 role(s).", "Everything matched. ✅"])).toBe("Linked 3 role(s).\nEverything matched. ✅");
  });
});
