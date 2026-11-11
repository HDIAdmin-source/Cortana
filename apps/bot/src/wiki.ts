import type { Db } from "./db";

/**
 * Ship catalogue from the Star Citizen Wiki API (https://api.star-citizen.wiki).
 * Credit "api.star-citizen.wiki" wherever this data is shown (docs/SPEC.md).
 */
export const WIKI_CREDIT = "Ship data: api.star-citizen.wiki";

const API = "https://api.star-citizen.wiki/api/v2/vehicles";
const HEADERS = { "user-agent": "CortanaBot/1.0 (HDI org tool)", accept: "application/json" };
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export interface ShipRow {
  name: string;
  manufacturer: string | null;
  wiki_uuid: string;
  wiki_slug: string | null;
  role: string | null;
  career: string | null;
  size: string | null;
  crew_min: number | null;
  crew_max: number | null;
  kind: "spaceship" | "ground" | null;
}

export type PageResult = { ok: true; rows: ShipRow[]; lastPage: number } | { ok: false; reason: string };

type Localised = string | { en_EN?: string } | null | undefined;
const english = (v: Localised): string | null => (typeof v === "string" ? v : v?.en_EN ?? null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parse one page of /api/v2/vehicles. */
export function parseVehiclesPage(json: unknown): PageResult {
  const body = json as { data?: unknown; meta?: { last_page?: unknown } } | null;
  if (!body || !Array.isArray(body.data)) {
    return { ok: false, reason: "Star Citizen Wiki response not recognised" };
  }
  const rows: ShipRow[] = [];
  for (const raw of body.data as Record<string, any>[]) {
    if (typeof raw?.uuid !== "string" || typeof raw?.name !== "string" || !raw.name.trim()) continue;
    if (raw.is_power_suit) continue;
    rows.push({
      name: raw.name.trim(),
      manufacturer: typeof raw.manufacturer?.name === "string" ? raw.manufacturer.name : null,
      wiki_uuid: raw.uuid,
      wiki_slug: typeof raw.slug === "string" ? raw.slug : null,
      role: typeof raw.role === "string" ? raw.role : english(raw.foci?.[0]),
      career: typeof raw.career === "string" ? raw.career : english(raw.type),
      size: english(raw.size),
      crew_min: num(raw.crew?.min),
      crew_max: num(raw.crew?.max),
      kind: raw.is_spaceship ? "spaceship" : raw.is_vehicle || raw.is_gravlev ? "ground" : null,
    });
  }
  const lastPage = num(body.meta?.last_page) ?? 1;
  return { ok: true, rows, lastPage };
}

/**
 * The Wiki lists some ships twice (e.g. a "-display" model). Keep one per name and
 * manufacturer, preferring the normal entry.
 */
export function dedupeShips(rows: ShipRow[]): ShipRow[] {
  const best = new Map<string, ShipRow>();
  const isDisplay = (r: ShipRow) => /-display$/i.test(r.wiki_slug ?? "");
  for (const row of rows) {
    const key = `${row.name.toLowerCase()}|${(row.manufacturer ?? "").toLowerCase()}`;
    const current = best.get(key);
    if (!current || (isDisplay(current) && !isDisplay(row))) best.set(key, row);
  }
  return [...best.values()];
}

export async function fetchAllShips(fetchImpl: typeof fetch = fetch): Promise<{ ok: true; rows: ShipRow[] } | { ok: false; reason: string }> {
  const rows: ShipRow[] = [];
  let lastPage = 1;
  for (let page = 1; page <= Math.min(lastPage, MAX_PAGES); page++) {
    try {
      const res = await fetchImpl(`${API}?page[size]=${PAGE_SIZE}&page[number]=${page}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return { ok: false, reason: `Star Citizen Wiki returned ${res.status}` };
      const parsed = parseVehiclesPage(await res.json().catch(() => null));
      if (!parsed.ok) return parsed;
      rows.push(...parsed.rows);
      lastPage = parsed.lastPage;
    } catch (err) {
      return { ok: false, reason: `Could not reach the Star Citizen Wiki: ${(err as Error).message}` };
    }
  }
  return { ok: true, rows: dedupeShips(rows) };
}

/**
 * Add new ships and refresh existing ones. Ships are never deleted (members' hangars point
 * at them). If the Wiki can't be read, nothing is changed.
 */
export async function syncShips(db: Db, fetchImpl: typeof fetch = fetch): Promise<number> {
  const result = await fetchAllShips(fetchImpl);
  if (!result.ok) throw new Error(result.reason);
  const now = new Date().toISOString();
  for (let i = 0; i < result.rows.length; i += 200) {
    const batch = result.rows.slice(i, i + 200).map((r) => ({ ...r, updated_at: now }));
    const { error } = await db.from("ships").upsert(batch, { onConflict: "wiki_uuid" });
    if (error) throw new Error(`Saving ships failed: ${error.message}`);
  }
  return result.rows.length;
}
