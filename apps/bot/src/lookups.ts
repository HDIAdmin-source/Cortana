import type { Db } from "./db";

/**
 * Org structure for autocomplete menus, read from the database (nothing is hard-coded)
 * and cached for a minute.
 */
export interface OrgData {
  initiatives: { slug: string; name: string; is_home: boolean }[];
  divisions: { slug: string; name: string; initiative_slug: string }[];
  units: { name: string; division_slug: string; initiative_slug: string }[];
  ranks: { name: string; sort_order: number }[];
  rsiOrgSid: string | null;
}

export interface Lookups {
  get(): Promise<OrgData>;
  invalidate(): void;
}

type Row = Record<string, unknown>;
const one = (v: unknown): Row => (Array.isArray(v) ? (v[0] as Row) : (v as Row)) ?? {};

export function createLookups(db: Db): Lookups {
  let cached: OrgData | null = null;
  let loadedAt = 0;

  async function load(): Promise<OrgData> {
    const [initiatives, divisions, units, ranks, settings] = await Promise.all([
      db.from("initiatives").select("slug, name, is_home").order("sort_order"),
      db.from("divisions").select("slug, name, sort_order, initiatives(slug, sort_order)").order("sort_order"),
      db.from("units").select("name, sort_order, divisions(slug, initiatives(slug))").order("sort_order"),
      db.from("ranks").select("name, sort_order").order("sort_order"),
      db.from("org_settings").select("rsi_org_sid").maybeSingle(),
    ]);
    for (const r of [initiatives, divisions, units, ranks, settings]) {
      if (r.error) throw new Error(`Loading org data failed: ${r.error.message}`);
    }
    return {
      initiatives: (initiatives.data ?? []) as OrgData["initiatives"],
      divisions: (divisions.data ?? []).map((d: Row) => ({
        slug: String(d.slug),
        name: String(d.name),
        initiative_slug: String(one(d.initiatives).slug),
      })),
      units: (units.data ?? []).map((u: Row) => {
        const div = one(u.divisions);
        return { name: String(u.name), division_slug: String(div.slug), initiative_slug: String(one(div.initiatives).slug) };
      }),
      ranks: (ranks.data ?? []) as OrgData["ranks"],
      rsiOrgSid: (settings.data as { rsi_org_sid?: string } | null)?.rsi_org_sid ?? null,
    };
  }

  return {
    async get() {
      if (!cached || Date.now() - loadedAt > 60_000) {
        cached = await load();
        loadedAt = Date.now();
      }
      return cached;
    },
    invalidate() {
      cached = null;
    },
  };
}

/** Up to 25 autocomplete choices whose name contains what the user typed. */
export function choices<T>(items: T[], typed: string, toChoice: (item: T) => { name: string; value: string }) {
  const q = typed.trim().toLowerCase();
  return items
    .map(toChoice)
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q))
    .slice(0, 25)
    .map((c) => ({ name: c.name.slice(0, 100), value: c.value.slice(0, 100) }));
}
