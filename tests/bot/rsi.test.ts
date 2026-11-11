import { describe, expect, it } from "vitest";
import { checkBio, checkOrgMembership, newVerificationCode, parseOrgMembers, parseProfile } from "../../apps/bot/src/rsi";

// Small stand-ins shaped like RSI's real pages (checked against the live site, 11 Nov 2026).
const profile = (bio: string | null) => `
  <div class="profile">
    <p class="entry"><span class="label">Handle name</span> <strong class="value">TestPilot</strong></p>
    ${bio === null ? "" : `<div class="entry bio"> <span class="label">Bio</span> <div class="value">${bio}<br /> </div> </div>`}
  </div>`;

const memberItem = (nick: string, visibility = "V") => `
  <li class="member-item js-member-item org-visibility-${visibility}" data-org-sid="OLDHUNTERS">
    <a class="membercard js-edit-member" href="/citizens/${nick}">
      <span class="trans-03s name data4">Display ${nick}</span>
      <span class="trans-03s nick data3">${nick}</span>
      <span class="rank">Operator</span>
    </a>
  </li>`;

describe("reading the RSI profile bio", () => {
  it("finds the code anywhere in the bio, ignoring case and spacing", () => {
    expect(parseProfile(profile("Hauler. Proud HDI. hdi-7f3k o7"), "HDI-7F3K")).toEqual({ kind: "found" });
    expect(parseProfile(profile("code: HDI - 7F3K"), "HDI-7F3K")).toEqual({ kind: "found" });
  });

  it("reports a missing code, including when there's no bio at all", () => {
    expect(parseProfile(profile("just a pilot"), "HDI-7F3K")).toEqual({ kind: "code_missing" });
    expect(parseProfile(profile(null), "HDI-7F3K")).toEqual({ kind: "code_missing" });
  });

  it("says 'error' (not 'missing') when the page isn't laid out as expected", () => {
    expect(parseProfile("<html><body>Maintenance</body></html>", "HDI-7F3K").kind).toBe("error");
  });
});

describe("reading HDI's RSI member list", () => {
  it("finds an exact handle match among search results", () => {
    const json = { success: 1, data: { totalrows: 2, html: memberItem("TestPilot2") + memberItem("TestPilot") } };
    expect(parseOrgMembers(json, "testpilot")).toEqual({ kind: "member" });
  });

  it("doesn't accept a partial match", () => {
    const json = { success: 1, data: { totalrows: 1, html: memberItem("TestPilot2") } };
    expect(parseOrgMembers(json, "TestPilot")).toEqual({ kind: "not_listed" });
  });

  it("says 'error' when RSI's response isn't what we expect", () => {
    expect(parseOrgMembers({ success: 0, msg: "ErrValidationFailed" }, "x").kind).toBe("error");
    expect(parseOrgMembers(null, "x").kind).toBe("error");
    expect(parseOrgMembers("<html>", "x").kind).toBe("error");
  });
});

describe("network failures fail safe", () => {
  const failing = (async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  }) as unknown as typeof fetch;
  const status = (code: number) => (async () => new Response("nope", { status: code })) as unknown as typeof fetch;

  it("turns an unreachable or broken RSI into 'error', never into a failed check", async () => {
    expect((await checkBio("TestPilot", "HDI-7F3K", failing)).kind).toBe("error");
    expect((await checkOrgMembership("OLDHUNTERS", "TestPilot", failing)).kind).toBe("error");
    expect((await checkBio("TestPilot", "HDI-7F3K", status(503))).kind).toBe("error");
    expect((await checkOrgMembership("OLDHUNTERS", "TestPilot", status(429))).kind).toBe("error");
  });

  it("recognises a handle that doesn't exist", async () => {
    expect(await checkBio("NoSuchPerson", "HDI-7F3K", status(404))).toEqual({ kind: "no_such_citizen" });
  });
});

describe("verification codes", () => {
  it("look like HDI-XXXX without easily confused characters", () => {
    let n = 0;
    const code = newVerificationCode((max) => n++ % max);
    expect(code).toMatch(/^HDI-[A-HJ-NP-Z2-9]{4}$/);
  });
});
