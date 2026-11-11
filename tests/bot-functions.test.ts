import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPerson, asUser, botCall, createTestDb, rankOfDiscord } from "./helpers/db";

/**
 * Phase 2 rules, enforced by the bot_* database functions the Discord bot calls.
 * Each call runs as the service role, exactly like the bot.
 */

const WOLFFE = "201532643483975681"; // seeded: Org Chairman, Admin

// Test people (Discord IDs are made up)
const EOS_CHAIR = "eos-chair"; //        Chair of Eos, NOT an Admin
const INDUSTRY_DIR = "industry-dir"; //  Director, Eos Industry Division Director
const EOS_IND_HOPLITE = "eos-ind-hoplite";
const EOS_COM_HOPLITE = "eos-com-hoplite";
const HELIOS_HOPLITE = "helios-hoplite";
const APPLICANT = "applicant";

let db: PGlite;

beforeEach(async () => {
  db = await createTestDb();
  await addPerson(db, {
    discordId: EOS_CHAIR, name: "EosChair", rank: "Chair", home: { initiative: "eos" },
    appointment: { title: "Chair of Eos", scope: "initiative", initiative: "eos" },
  });
  await addPerson(db, {
    discordId: INDUSTRY_DIR, name: "IndustryDirector", rank: "Director", home: { initiative: "eos", division: "industry" },
    appointment: { title: "Industry Division Director", scope: "division", initiative: "eos", division: "industry" },
  });
  await addPerson(db, { discordId: EOS_IND_HOPLITE, name: "Miner", rank: "Hoplite", home: { initiative: "eos", division: "industry" } });
  await addPerson(db, { discordId: EOS_COM_HOPLITE, name: "Trader", rank: "Hoplite", home: { initiative: "eos", division: "commerce" } });
  await addPerson(db, { discordId: HELIOS_HOPLITE, name: "Pilot", rank: "Hoplite", home: { initiative: "helios", division: "fleet" } });
});

afterEach(async () => {
  await db.close();
});

async function enlistAndVerify(discordId: string, name = "Recruit") {
  await botCall(db, "bot_enlist", discordId, name, `rsi_${discordId}`, "Europe/London", "eos");
  await botCall(db, "bot_start_verification", discordId, `rsi_${discordId}`, "HDI-TEST");
  const pending = await botCall<{ code_id: string }>(db, "bot_pending_verification", discordId);
  await botCall(db, "bot_complete_verification", discordId, pending.code_id);
}

describe("/enlist", () => {
  it("creates an applicant once, remembering the initiative they asked for", async () => {
    const first = await botCall<{ status: string; initiative: string }>(
      db, "bot_enlist", APPLICANT, "Recruit", "RecruitHandle", "Europe/London", "eos",
    );
    expect(first).toMatchObject({ status: "created", initiative: "Eos" });

    const again = await botCall<{ status: string; member_status: string }>(
      db, "bot_enlist", APPLICANT, "Recruit", "RecruitHandle", "Europe/London", "eos",
    );
    expect(again).toEqual({ status: "exists", member_status: "applicant" });

    const { rows } = await db.query<{ status: string; rank_id: string | null; interested: string }>(
      `select m.status, m.rank_id, i.slug as interested
         from members m join initiatives i on i.id = m.interested_initiative_id where m.discord_id = $1`,
      [APPLICANT],
    );
    expect(rows[0]).toEqual({ status: "applicant", rank_id: null, interested: "eos" });
  });

  it("only allows a home initiative, a valid handle, and a handle nobody else has", async () => {
    await expect(botCall(db, "bot_enlist", APPLICANT, "R", "Handle1", "UTC", "auxiliary")).rejects.toThrow(/home initiatives/);
    await expect(botCall(db, "bot_enlist", APPLICANT, "R", "bad handle!", "UTC", "eos")).rejects.toThrow(/RSI handle/);
    await expect(botCall(db, "bot_enlist", APPLICANT, "R", `rsi_${HELIOS_HOPLITE}`, "UTC", "eos")).rejects.toThrow(/already linked/);
  });
});

describe("/verify", () => {
  it("marks the handle verified once the code is found, and each code works once", async () => {
    await botCall(db, "bot_enlist", APPLICANT, "Recruit", "RecruitHandle", "UTC", "eos");
    await botCall(db, "bot_start_verification", APPLICANT, "RecruitHandle", "HDI-7F3K");

    const pending = await botCall<{ code_id: string; code: string; rsi_handle: string }>(db, "bot_pending_verification", APPLICANT);
    expect(pending).toMatchObject({ code: "HDI-7F3K", rsi_handle: "RecruitHandle" });

    const done = await botCall<{ status: string }>(db, "bot_complete_verification", APPLICANT, pending.code_id);
    expect(done).toEqual({ rsi_handle: "RecruitHandle", status: "applicant" }); // verified, not yet accepted

    await expect(botCall(db, "bot_complete_verification", APPLICANT, pending.code_id)).rejects.toThrow(/expired/);
    expect(await botCall(db, "bot_pending_verification", APPLICANT)).toBeNull();
  });

  it("rejects an expired code", async () => {
    await botCall(db, "bot_enlist", APPLICANT, "Recruit", "RecruitHandle", "UTC", "eos");
    await botCall(db, "bot_start_verification", APPLICANT, "RecruitHandle", "HDI-AAAA");
    const { rows } = await db.query<{ id: string }>(
      "update verification_codes set expires_at = now() - interval '1 minute' returning id",
    );
    await expect(botCall(db, "bot_complete_verification", APPLICANT, rows[0]!.id)).rejects.toThrow(/expired/);
  });

  it("lets only an Admin verify someone by hand", async () => {
    await botCall(db, "bot_enlist", APPLICANT, "Recruit", "RecruitHandle", "UTC", "eos");
    await expect(botCall(db, "bot_manual_verify", EOS_CHAIR, APPLICANT, "RecruitHandle")).rejects.toThrow(/Only an Admin/);
    await botCall(db, "bot_manual_verify", WOLFFE, APPLICANT, "RecruitHandle");
    const { rows } = await db.query("select 1 from members where discord_id = $1 and rsi_verified_at is not null", [APPLICANT]);
    expect(rows).toHaveLength(1);
  });
});

describe("/assign", () => {
  it("won't accept an applicant who hasn't verified", async () => {
    await botCall(db, "bot_enlist", APPLICANT, "Recruit", "RecruitHandle", "UTC", "eos");
    await expect(botCall(db, "bot_assign", EOS_CHAIR, APPLICANT, "eos", "industry", null, false)).rejects.toThrow(/pass \/verify/);
  });

  it("accepts a verified applicant: active, entry rank, logged with who did it", async () => {
    await enlistAndVerify(APPLICANT);
    const result = await botCall(db, "bot_assign", EOS_CHAIR, APPLICANT, "eos", "industry", null, false);
    expect(result).toEqual({ accepted: true, initiative: "Eos", rank: "Hoplite" });

    const { rows } = await db.query<{ status: string; reason: string; approver: string }>(
      `select m.status, h.reason, a.discord_name as approver
         from members m
         join rank_history h on h.member_id = m.id
         join members a on a.id = h.approved_by
        where m.discord_id = $1`,
      [APPLICANT],
    );
    expect(rows).toEqual([{ status: "active", reason: "Accepted into Eos", approver: "EosChair" }]);

    const audit = await db.query<{ actor: string }>(
      `select a.discord_name as actor from audit_log l join members a on a.id = l.actor_id
        where l.table_name = 'member_assignments' and l.action = 'insert'
          and l.after ->> 'member_id' = (select id::text from members where discord_id = $1)`,
      [APPLICANT],
    );
    expect(audit.rows).toEqual([{ actor: "EosChair" }]);
  });

  it("keeps a Chair inside their own initiative", async () => {
    await enlistAndVerify(APPLICANT);
    await expect(botCall(db, "bot_assign", EOS_CHAIR, APPLICANT, "helios", "fleet", null, false)).rejects.toThrow(
      /own initiative or division/,
    );
    // Nor can they pull a Helios member into Eos.
    await expect(botCall(db, "bot_assign", EOS_CHAIR, HELIOS_HOPLITE, "eos", "industry", null, false)).rejects.toThrow(
      /don't lead/,
    );
  });

  it("keeps a Division Director inside their own division", async () => {
    await enlistAndVerify(APPLICANT);
    await expect(botCall(db, "bot_assign", INDUSTRY_DIR, APPLICANT, "eos", "commerce", null, false)).rejects.toThrow(
      /own initiative or division/,
    );
    await botCall(db, "bot_assign", INDUSTRY_DIR, APPLICANT, "eos", "industry", null, false);
    expect(await rankOfDiscord(db, APPLICANT)).toBe("Hoplite");
  });

  it("adds and removes Auxiliary divisions, for active members only", async () => {
    await botCall(db, "bot_assign", WOLFFE, HELIOS_HOPLITE, "auxiliary", "pathfinder", null, false);
    const count = async () =>
      (await db.query(
        `select 1 from member_assignments a join members m on m.id = a.member_id
          where m.discord_id = $1 and not a.is_primary`,
        [HELIOS_HOPLITE],
      )).rows.length;
    expect(await count()).toBe(1);

    await botCall(db, "bot_assign", WOLFFE, HELIOS_HOPLITE, "auxiliary", "pathfinder", null, true);
    expect(await count()).toBe(0);

    await botCall(db, "bot_enlist", APPLICANT, "Recruit", "RecruitHandle", "UTC", "eos");
    await expect(botCall(db, "bot_assign", WOLFFE, APPLICANT, "auxiliary", "pathfinder", null, false)).rejects.toThrow(
      /Only active members/,
    );
  });
});

describe("/promote", () => {
  it("lets a Chair promote within their initiative up to Prefect, with the reason recorded", async () => {
    const result = await botCall(db, "bot_promote", EOS_CHAIR, EOS_COM_HOPLITE, "Prefect", "Runs the trade desk");
    expect(result).toEqual({ result: "changed", rank: "Prefect" });

    const { rows } = await db.query<{ reason: string; approver: string }>(
      `select h.reason, a.discord_name as approver from rank_history h
         join members a on a.id = h.approved_by
        where h.member_id = (select id from members where discord_id = $1) and h.reason is not null`,
      [EOS_COM_HOPLITE],
    );
    expect(rows).toEqual([{ reason: "Runs the trade desk", approver: "EosChair" }]);
  });

  it("lets a Division Director promote only inside their division", async () => {
    await botCall(db, "bot_promote", INDUSTRY_DIR, EOS_IND_HOPLITE, "Operator", "Qualified");
    expect(await rankOfDiscord(db, EOS_IND_HOPLITE)).toBe("Operator");

    await expect(botCall(db, "bot_promote", INDUSTRY_DIR, EOS_COM_HOPLITE, "Operator", "Qualified")).rejects.toThrow(
      /can't make that rank change/,
    );
    expect(await rankOfDiscord(db, EOS_COM_HOPLITE)).toBe("Hoplite");
  });

  it("turns a promotion above Prefect into a proposal that an Admin approves", async () => {
    const proposed = await botCall<{ result: string; request_id: string }>(
      db, "bot_promote", EOS_CHAIR, EOS_IND_HOPLITE, "Praetor", "Led the Pyro mining op",
    );
    expect(proposed.result).toBe("proposed");
    expect(await rankOfDiscord(db, EOS_IND_HOPLITE)).toBe("Hoplite");

    const pending = await botCall<Array<{ discord_id: string; to_rank: string }>>(db, "bot_pending_promotions");
    expect(pending).toMatchObject([{ discord_id: EOS_IND_HOPLITE, to_rank: "Praetor" }]);

    await expect(botCall(db, "bot_decide_promotion", EOS_CHAIR, proposed.request_id, true)).rejects.toThrow(/Only an Admin/);

    const decided = await botCall(db, "bot_decide_promotion", WOLFFE, proposed.request_id, true);
    expect(decided).toEqual({ result: "approved", discord_id: EOS_IND_HOPLITE, rank: "Praetor" });
    expect(await rankOfDiscord(db, EOS_IND_HOPLITE)).toBe("Praetor");
  });

  it("stops leaders crossing initiatives, demoting, or promoting themselves", async () => {
    await expect(botCall(db, "bot_promote", EOS_CHAIR, HELIOS_HOPLITE, "Operator", "x")).rejects.toThrow(/can't make/);
    await botCall(db, "bot_promote", EOS_CHAIR, EOS_COM_HOPLITE, "Specialist", "x");
    await expect(botCall(db, "bot_promote", EOS_CHAIR, EOS_COM_HOPLITE, "Operator", "demote")).rejects.toThrow(/can't make/);
    await expect(botCall(db, "bot_promote", INDUSTRY_DIR, INDUSTRY_DIR, "Chair", "me")).rejects.toThrow(/can't make/);
    await expect(botCall(db, "bot_promote", WOLFFE, EOS_IND_HOPLITE, "Operator", "  ")).rejects.toThrow(/reason is required/);
  });

  it("lets an Admin demote", async () => {
    await botCall(db, "bot_promote", WOLFFE, EOS_COM_HOPLITE, "Prefect", "x");
    await botCall(db, "bot_promote", WOLFFE, EOS_COM_HOPLITE, "Operator", "Stepped back");
    expect(await rankOfDiscord(db, EOS_COM_HOPLITE)).toBe("Operator");
  });
});

describe("Discord role sync data", () => {
  async function linkEosRoles() {
    const targets = await botCall<Array<{ kind: string; id: string | null; slug: string | null; label: string }>>(
      db, "bot_role_targets",
    );
    const pick = (label: string) => {
      const t = targets.find((x) => x.label === label);
      if (!t) throw new Error(`no target ${label}`);
      return t;
    };
    const links = [
      { ...pick("Initiative: Eos"), role_id: "r-eos" },
      { ...pick("Division: Eos / Industry"), role_id: "r-industry" },
      { ...pick("Rank: Hoplite (Eos)"), role_id: "r-e-hoplite" },
      { ...pick("Rank: Hoplite (Helios)"), role_id: "r-h-hoplite" },
      { ...pick("Active member role"), role_id: "r-hdi" },
    ];
    return botCall<number>(db, "bot_set_role_ids", WOLFFE, JSON.stringify(links));
  }

  it("names each role the way the live server does", async () => {
    const targets = await botCall<Array<{ label: string; expected_name: string | null }>>(db, "bot_role_targets");
    const expected = Object.fromEntries(targets.map((t) => [t.label, t.expected_name]));
    expect(expected).toMatchObject({
      "Rank: Operator (Helios)": "H-Operator",
      "Rank: Hoplite (Eos)": "E-Hoplite",
      "Rank: Centurion (Selene)": "S-Centurion",
      "Rank: Chair (Helios)": "Chair of Helios",
      "Rank: Director (Eos)": "Division Director",
      "Division: Eos / Archaeology": "Eos - Archeology Division",
      "Unit: Helios / Medical / N.O.V.A.": "N.O.V.A.",
      "Active member role": "HDI",
      "Initiative: Auxiliary": null, // owner: no Auxiliary role
    });
    // Auxiliary has no rank ladder, so no rank roles.
    expect(targets.some((t) => t.label.startsWith("Rank:") && t.label.includes("Auxiliary"))).toBe(false);
  });

  it("lets only an Admin link roles", async () => {
    await expect(botCall(db, "bot_set_role_ids", EOS_CHAIR, "[]")).rejects.toThrow(/Only an Admin/);
    expect(await linkEosRoles()).toBe(5);
  });

  it("gives an active member exactly their initiative, division, rank and HDI roles", async () => {
    await linkEosRoles();
    const state = await botCall<{ in_cortana: boolean; desired: string[]; managed: string[] }>(
      db, "bot_role_state", EOS_IND_HOPLITE,
    );
    expect(state.in_cortana).toBe(true);
    expect([...state.desired].sort()).toEqual(["r-e-hoplite", "r-eos", "r-hdi", "r-industry"]);
    expect([...state.managed].sort()).toEqual(["r-e-hoplite", "r-eos", "r-h-hoplite", "r-hdi", "r-industry"]);

    // A departed member should hold none of them.
    await db.query("update members set status = 'departed' where discord_id = $1", [EOS_IND_HOPLITE]);
    const gone = await botCall<{ desired: string[] }>(db, "bot_role_state", EOS_IND_HOPLITE);
    expect(gone.desired).toEqual([]);

    // Someone Cortana doesn't know about is left alone entirely.
    expect(await botCall(db, "bot_role_state", "stranger")).toEqual({ in_cortana: false });
  });
});

describe("/profile and /roster", () => {
  it("lets an applicant see only their own profile, and not the roster", async () => {
    await botCall(db, "bot_enlist", APPLICANT, "Recruit", "RecruitHandle", "UTC", "eos");
    const own = await botCall<{ status: string }>(db, "bot_profile", APPLICANT, APPLICANT);
    expect(own.status).toBe("applicant");
    await expect(botCall(db, "bot_profile", APPLICANT, EOS_CHAIR)).rejects.toThrow(/verified active members/);
    await expect(botCall(db, "bot_roster", APPLICANT, null, null)).rejects.toThrow(/verified active members/);
  });

  it("shows a member the roster, filtered by initiative and division", async () => {
    const eos = await botCall<Array<{ discord_name: string }>>(db, "bot_roster", HELIOS_HOPLITE, "eos", null);
    expect(eos.map((m) => m.discord_name)).toEqual(["Chance", "EosChair", "IndustryDirector", "Miner", "Trader"]);

    const industry = await botCall<Array<{ discord_name: string }>>(db, "bot_roster", HELIOS_HOPLITE, "eos", "industry");
    expect(industry.map((m) => m.discord_name)).toEqual(["IndustryDirector", "Miner"]);
  });
});

describe("security", () => {
  it("doesn't let website users call the bot's functions", async () => {
    const { rows } = await db.query<{ id: string }>("insert into auth.users (id) values (gen_random_uuid()) returning id");
    await db.query("update members set auth_user_id = $1 where discord_id = $2", [rows[0]!.id, EOS_COM_HOPLITE]);
    await expect(
      asUser(db, rows[0]!.id, (tx) =>
        tx.query("select bot_promote($1, $2, 'Chair', 'self-service')", [EOS_COM_HOPLITE, EOS_COM_HOPLITE]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
