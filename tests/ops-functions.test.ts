import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPerson, botCall, createTestDb } from "./helpers/db";

/**
 * Phase 3 rules (operations, sign-ups, attendance, after-action, hangars), enforced by the
 * bot_* database functions. "Done" per the spec: an officer can post an op, members sign up,
 * and attendance is recorded.
 */
const OFFICER = "officer"; //   Praetor
const MEMBER = "member"; //     Operator, verified
const MEMBER2 = "member2";
const UNVERIFIED = "unverified";
const PREFECT = "prefect"; //   Prefect: not an Officer (spec: "to confirm")

let db: PGlite;
let avenger: string;
let cutlass: string;

const inOneDay = () => new Date(Date.now() + 86_400_000).toISOString();

beforeEach(async () => {
  db = await createTestDb();
  await addPerson(db, { discordId: OFFICER, name: "Officer", rank: "Praetor", home: { initiative: "helios", division: "fleet" } });
  await addPerson(db, { discordId: MEMBER, name: "Alpha", rank: "Operator", home: { initiative: "helios", division: "fleet" } });
  await addPerson(db, { discordId: MEMBER2, name: "Bravo", rank: "Hoplite", home: { initiative: "eos" } });
  await addPerson(db, { discordId: UNVERIFIED, name: "Newbie", rank: "Hoplite", verified: false, home: { initiative: "eos" } });
  await addPerson(db, { discordId: PREFECT, name: "Prefect", rank: "Prefect", home: { initiative: "selene" } });
  const ships = await db.query<{ id: string; name: string }>(
    `insert into ships (name, manufacturer, wiki_uuid, role, crew_min, crew_max, kind)
     values ('Avenger Titan', 'Aegis Dynamics', 'u-1', 'Light Freight', 1, 1, 'spaceship'),
            ('Cutlass Black', 'Drake Interplanetary', 'u-2', 'Medium Freight', 1, 3, 'spaceship')
     returning id, name`,
  );
  avenger = ships.rows.find((s) => s.name === "Avenger Titan")!.id;
  cutlass = ships.rows.find((s) => s.name === "Cutlass Black")!.id;
});

afterEach(async () => {
  await db.close();
});

async function createOp(actor = OFFICER) {
  const { id } = await botCall<{ id: string }>(
    db, "bot_op_create", actor, "Operation Daybreak", inOneDay(), "Escort the haulers", "helios", "Port Olisar", null,
  );
  return id;
}

type Summary = { status: string; signups: { discord_id: string; status: string; role: string | null; ship: string | null }[] };

describe("/op create", () => {
  it("lets an Officer create an op, with them as commander", async () => {
    const id = await createOp();
    const op = await botCall<{ name: string; commander_discord_id: string; initiative: string; status: string }>(
      db, "bot_op_summary", id,
    );
    expect(op).toMatchObject({ name: "Operation Daybreak", commander_discord_id: OFFICER, initiative: "Helios", status: "planned" });
  });

  it("refuses ordinary members and Prefects", async () => {
    await expect(createOp(MEMBER)).rejects.toThrow(/Only Officers/);
    await expect(createOp(PREFECT)).rejects.toThrow(/Only Officers/);
  });

  it("refuses a start time in the past", async () => {
    await expect(
      botCall(db, "bot_op_create", OFFICER, "Late op", new Date(Date.now() - 60_000).toISOString(), null, null, null, null),
    ).rejects.toThrow(/in the past/);
  });
});

describe("sign-up buttons", () => {
  it("records Going / Maybe / Declined, and lets people change their mind", async () => {
    const id = await createOp();
    await botCall(db, "bot_op_signup", MEMBER, id, "going");
    await botCall(db, "bot_op_signup", MEMBER2, id, "maybe");
    await botCall(db, "bot_op_signup", MEMBER2, id, "declined");

    const op = await botCall<Summary>(db, "bot_op_summary", id);
    expect(op.signups.map((s) => [s.discord_id, s.status])).toEqual([
      [MEMBER, "going"],
      [MEMBER2, "declined"],
    ]);
  });

  it("is for verified active members only", async () => {
    const id = await createOp();
    await expect(botCall(db, "bot_op_signup", UNVERIFIED, id, "going")).rejects.toThrow(/verified active members/);
    await expect(botCall(db, "bot_op_signup", "stranger", id, "going")).rejects.toThrow(/verified active members/);
  });

  it("lets a member pick a ship from their own hangar and a role", async () => {
    const id = await createOp();
    const { rows } = await db.query<{ id: string }>(
      "insert into member_ships (member_id, ship_id) select id, $1 from members where discord_id = $2 returning id",
      [cutlass, MEMBER],
    );
    await botCall(db, "bot_op_signup", MEMBER, id, "going");
    await botCall(db, "bot_op_set_ship", MEMBER, id, rows[0]!.id);
    await botCall(db, "bot_op_set_role", MEMBER, id, "Pilot");

    const op = await botCall<Summary>(db, "bot_op_summary", id);
    expect(op.signups[0]).toMatchObject({ ship: "Cutlass Black", role: "Pilot" });

    // Someone else's ship can't be claimed.
    await botCall(db, "bot_op_signup", MEMBER2, id, "going");
    await expect(botCall(db, "bot_op_set_ship", MEMBER2, id, rows[0]!.id)).rejects.toThrow(/isn't in your hangar/);
  });

  it("closes when the op is cancelled", async () => {
    const id = await createOp();
    await expect(botCall(db, "bot_op_cancel", MEMBER, id)).rejects.toThrow(/Only Officers/);
    await botCall(db, "bot_op_cancel", OFFICER, id);
    await expect(botCall(db, "bot_op_signup", MEMBER, id, "going")).rejects.toThrow(/closed/);
  });
});

describe("/op attend and /op aar", () => {
  it("records attendance, including walk-ins, and only Officers can take it", async () => {
    const id = await createOp();
    await botCall(db, "bot_op_signup", MEMBER, id, "going");

    await expect(botCall(db, "bot_op_attend", MEMBER, id, [MEMBER], true)).rejects.toThrow(/Only Officers/);

    const result = await botCall<{ changed: number; unknown: string[]; attended_total: number }>(
      db, "bot_op_attend", OFFICER, id, [MEMBER, MEMBER2, "not-in-cortana"], true,
    );
    expect(result).toEqual({ changed: 2, unknown: ["not-in-cortana"], attended_total: 2 });

    const op = await botCall<Summary>(db, "bot_op_summary", id);
    expect(op.status).toBe("live");
    expect(op.signups.filter((s) => s.status === "attended").map((s) => s.discord_id).sort()).toEqual([MEMBER, MEMBER2]);

    // A member can't undo their own attendance with the buttons.
    await expect(botCall(db, "bot_op_signup", MEMBER, id, "declined")).rejects.toThrow(/already been marked as attended/);

    // An Officer can un-mark a mistake.
    const undo = await botCall<{ attended_total: number }>(db, "bot_op_attend", OFFICER, id, [MEMBER2], false);
    expect(undo.attended_total).toBe(1);
  });

  it("records the after-action report and closes the op", async () => {
    const id = await createOp();
    await botCall(db, "bot_op_attend", OFFICER, id, [MEMBER], true);
    await expect(botCall(db, "bot_op_aar", MEMBER, id, "We won", false)).rejects.toThrow(/Only Officers/);

    const aar = await botCall<{ attended: number }>(db, "bot_op_aar", OFFICER, id, "Convoy delivered, no losses.", true);
    expect(aar.attended).toBe(1);

    const op = await botCall<{ status: string; after_action: string; is_public: boolean }>(db, "bot_op_summary", id);
    expect(op).toMatchObject({ status: "completed", after_action: "Convoy delivered, no losses.", is_public: true });

    // Logged with who did it.
    const audit = await db.query<{ actor: string }>(
      `select a.discord_name as actor from audit_log l join members a on a.id = l.actor_id
        where l.table_name = 'operations' and l.row_id = $1 and l.after ->> 'status' = 'completed'`,
      [id],
    );
    expect(audit.rows).toEqual([{ actor: "Officer" }]);
  });
});

describe("/hangar", () => {
  it("keeps a member's hangar private; Officers only see ships offered for ops", async () => {
    await botCall(db, "bot_hangar_add", MEMBER, avenger, false);
    await botCall(db, "bot_hangar_add", MEMBER, cutlass, true);

    const own = await botCall<{ ship: string }[]>(db, "bot_hangar_list", MEMBER, MEMBER);
    expect(own.map((s) => s.ship)).toEqual(["Avenger Titan", "Cutlass Black"]);

    const officerView = await botCall<{ ship: string }[]>(db, "bot_hangar_list", OFFICER, MEMBER);
    expect(officerView.map((s) => s.ship)).toEqual(["Cutlass Black"]);

    await expect(botCall(db, "bot_hangar_list", MEMBER2, MEMBER)).rejects.toThrow(/private/);
  });

  it("lets members change availability or remove ships, but only their own", async () => {
    const added = await botCall<{ ship: string }>(db, "bot_hangar_add", MEMBER, avenger, false);
    expect(added.ship).toBe("Avenger Titan");
    const [entry] = await botCall<{ id: string }[]>(db, "bot_hangar_list", MEMBER, MEMBER);

    await expect(botCall(db, "bot_hangar_update", MEMBER2, entry!.id, true, false)).rejects.toThrow(/isn't in your hangar/);
    await botCall(db, "bot_hangar_update", MEMBER, entry!.id, true, false);
    expect((await botCall<{ available_for_ops: boolean }[]>(db, "bot_hangar_list", MEMBER, MEMBER))[0]!.available_for_ops).toBe(true);

    await botCall(db, "bot_hangar_update", MEMBER, entry!.id, false, true);
    expect(await botCall(db, "bot_hangar_list", MEMBER, MEMBER)).toEqual([]);
  });

  it("is for verified members only", async () => {
    await expect(botCall(db, "bot_hangar_add", UNVERIFIED, avenger, false)).rejects.toThrow(/verified active members/);
  });
});
