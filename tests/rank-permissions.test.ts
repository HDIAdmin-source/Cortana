import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addMember, asUser, createTestDb, rankId, rankNameOf, type TestMember } from "./helpers/db";

/**
 * Phase 1 "done" check (docs/SPEC.md, Roadmap): a Member cannot change ranks, an Admin can.
 * Each test talks to the database the way the website or bot would for a logged-in user,
 * so these prove the DATABASE enforces the rule, not just the buttons on screen.
 */

let db: PGlite;
let member: TestMember; // ordinary Operator
let other: TestMember; // another ordinary member
let admin: TestMember; // =The High Table=

beforeEach(async () => {
  db = await createTestDb();
  member = await addMember(db, { name: "member", rank: "Operator" });
  other = await addMember(db, { name: "other", rank: "Hoplite" });
  admin = await addMember(db, { name: "admin", rank: "Centurion", admin: true });
});

afterEach(async () => {
  await db.close();
});

describe("seed data", () => {
  it("loads the initiatives, divisions, units and the eight-rank ladder", async () => {
    const ranks = await db.query<{ name: string }>("select name from ranks order by sort_order");
    expect(ranks.rows.map((r) => r.name)).toEqual([
      "Hoplite", "Operator", "Specialist", "Prefect", "Praetor", "Centurion", "Director", "Chair",
    ]);

    const initiatives = await db.query<{ slug: string; is_home: boolean }>(
      "select slug, is_home from initiatives order by sort_order",
    );
    expect(initiatives.rows).toEqual([
      { slug: "helios", is_home: true },
      { slug: "eos", is_home: true },
      { slug: "selene", is_home: true },
      { slug: "auxiliary", is_home: false },
    ]);

    const counts = await db.query<{ divisions: number; units: number }>(
      "select (select count(*)::int from divisions) as divisions, (select count(*)::int from units) as units",
    );
    expect(counts.rows[0]).toEqual({ divisions: 12, units: 10 });
  });
});

describe("a Member", () => {
  it("cannot promote themselves by editing their own record", async () => {
    const centurion = await rankId(db, "Centurion");
    await expect(
      asUser(db, member.authUserId, (tx) =>
        tx.query("update members set rank_id = $1 where id = $2", [centurion, member.id]),
      ),
    ).rejects.toThrow(/Only an Admin can change a member's rank/);
    expect(await rankNameOf(db, member.id)).toBe("Operator");
  });

  it("cannot change another member's rank", async () => {
    const praetor = await rankId(db, "Praetor");
    const result = await asUser(db, member.authUserId, (tx) =>
      tx.query("update members set rank_id = $1 where id = $2", [praetor, other.id]),
    );
    // Row-level security hides the row from the update entirely.
    expect(result.affectedRows ?? 0).toBe(0);
    expect(await rankNameOf(db, other.id)).toBe("Hoplite");
  });

  it("cannot change ranks through change_rank()", async () => {
    const specialist = await rankId(db, "Specialist");
    await expect(
      asUser(db, member.authUserId, (tx) =>
        tx.query("select change_rank($1, $2, $3)", [other.id, specialist, "trying it on"]),
      ),
    ).rejects.toThrow(/Only an Admin can change a member's rank/);
    expect(await rankNameOf(db, other.id)).toBe("Hoplite");
  });

  it("cannot rename or reorder the rank ladder", async () => {
    const result = await asUser(db, member.authUserId, (tx) =>
      tx.query("update ranks set name = 'Supreme Commander', sort_order = 99 where name = 'Hoplite'"),
    );
    expect(result.affectedRows ?? 0).toBe(0);
    const { rows } = await db.query("select 1 from ranks where name = 'Hoplite' and sort_order = 1");
    expect(rows).toHaveLength(1);
  });

  it("cannot write rank history directly", async () => {
    const centurion = await rankId(db, "Centurion");
    await expect(
      asUser(db, member.authUserId, (tx) =>
        tx.query("insert into rank_history (member_id, to_rank, reason) values ($1, $2, 'forged')", [
          member.id,
          centurion,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("can still edit their own timezone (the guard is specific to rank and status)", async () => {
    await asUser(db, member.authUserId, (tx) =>
      tx.query("update members set timezone = 'Europe/London' where id = $1", [member.id]),
    );
    const { rows } = await db.query<{ timezone: string }>("select timezone from members where id = $1", [
      member.id,
    ]);
    expect(rows[0]!.timezone).toBe("Europe/London");
  });
});

describe("an Admin", () => {
  it("can change a member's rank with change_rank(), which records history and an audit entry", async () => {
    const specialist = await rankId(db, "Specialist");

    await asUser(db, admin.authUserId, (tx) =>
      tx.query("select change_rank($1, $2, $3)", [member.id, specialist, "Led three ops this month"]),
    );

    expect(await rankNameOf(db, member.id)).toBe("Specialist");

    const history = await db.query<{ from_name: string; to_name: string; reason: string; approved_by: string }>(
      `select f.name as from_name, t.name as to_name, h.reason, h.approved_by
         from rank_history h
         join ranks f on f.id = h.from_rank
         join ranks t on t.id = h.to_rank
        where h.member_id = $1`,
      [member.id],
    );
    expect(history.rows).toEqual([
      { from_name: "Operator", to_name: "Specialist", reason: "Led three ops this month", approved_by: admin.id },
    ]);

    const audit = await db.query<{ actor_id: string; actor_role: string }>(
      `select actor_id, actor_role from audit_log
        where table_name = 'members' and row_id = $1 and action = 'update'`,
      [member.id],
    );
    expect(audit.rows).toContainEqual({ actor_id: admin.id, actor_role: "authenticated" });
  });

  it("can change a member's rank by updating the record directly", async () => {
    const praetor = await rankId(db, "Praetor");
    const result = await asUser(db, admin.authUserId, (tx) =>
      tx.query("update members set rank_id = $1 where id = $2", [praetor, other.id]),
    );
    expect(result.affectedRows).toBe(1);
    expect(await rankNameOf(db, other.id)).toBe("Praetor");
  });

  it("can rename a rank in the ladder", async () => {
    const result = await asUser(db, admin.authUserId, (tx) =>
      tx.query("update ranks set name = 'Recruit' where name = 'Hoplite'"),
    );
    expect(result.affectedRows).toBe(1);
    const { rows } = await db.query("select 1 from ranks where name = 'Recruit' and sort_order = 1");
    expect(rows).toHaveLength(1);
  });

  it("loses rank-change power when their org appointment ends", async () => {
    await db.query("update appointments set starts_on = current_date - 30, ends_on = current_date where member_id = $1", [
      admin.id,
    ]);
    const specialist = await rankId(db, "Specialist");
    await expect(
      asUser(db, admin.authUserId, (tx) =>
        tx.query("select change_rank($1, $2, $3)", [member.id, specialist, "after term ended"]),
      ),
    ).rejects.toThrow(/Only an Admin can change a member's rank/);
  });
});
