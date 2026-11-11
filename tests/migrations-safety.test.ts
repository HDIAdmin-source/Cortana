import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Real Supabase blocks UPDATE and DELETE statements that have no WHERE clause (its
 * pg-safeupdate safety switch). The in-memory test database doesn't, so this check reads
 * every migration and fails if a function body would trip it. A later migration that
 * replaces the function fixes it, so only the newest definition of each function counts.
 */
const dir = join(process.cwd(), "supabase", "migrations");

function latestFunctionBodies(): Map<string, { file: string; body: string }> {
  const latest = new Map<string, { file: string; body: string }>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, file), "utf8");
    const re = /create (?:or replace )?function\s+([\w.]+)\s*\(([^)]*)\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi;
    for (const m of sql.matchAll(re)) {
      latest.set(`${m[1]}(${m[2]!.replace(/\s+/g, " ").trim()})`, { file, body: m[3]! });
    }
  }
  return latest;
}

describe("migrations work on real Supabase", () => {
  it("never UPDATE or DELETE without a WHERE clause", () => {
    const offenders: string[] = [];
    for (const [fn, { file, body }] of latestFunctionBodies()) {
      // Split into statements; strip comments first.
      const statements = body.replace(/--[^\n]*/g, "").split(";");
      for (const stmt of statements) {
        // The UPDATE/DELETE may sit after other words, e.g. inside "case ... when 'x' then update ...".
        const m = stmt.match(/\b(update\s+public\.\w+\s+set|delete\s+from\s+public\.\w+)/i);
        if (!m) continue;
        const fromVerb = stmt.slice(m.index!);
        if (!/\bwhere\b/i.test(fromVerb)) {
          offenders.push(`${fn} in ${file}: ${fromVerb.trim().split("\n")[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
