import { describe, expect, it } from "vitest";
import { dedupeShips, fetchAllShips, parseVehiclesPage } from "../../apps/bot/src/wiki";

// Shaped like api.star-citizen.wiki/api/v2/vehicles (checked against the live API, 13 Nov 2026).
const vehicle = (over: Record<string, unknown> = {}) => ({
  uuid: "0079c5d5-1678-4f8c-85ba-18ca8f642af6",
  name: "Avenger Titan",
  slug: "aegs-avenger-titan",
  manufacturer: { name: "Aegis Dynamics", code: "AEGS" },
  role: "Light Freight",
  career: "Transporter",
  crew: { min: 1, max: 1 },
  size: { en_EN: "Small", de_DE: "Klein" },
  is_spaceship: true,
  is_vehicle: false,
  is_gravlev: false,
  ...over,
});

describe("Star Citizen Wiki ship list", () => {
  it("turns a page into ship rows", () => {
    const page = parseVehiclesPage({ data: [vehicle()], meta: { last_page: 4 } });
    expect(page).toEqual({
      ok: true,
      lastPage: 4,
      rows: [
        {
          name: "Avenger Titan",
          manufacturer: "Aegis Dynamics",
          wiki_uuid: "0079c5d5-1678-4f8c-85ba-18ca8f642af6",
          wiki_slug: "aegs-avenger-titan",
          role: "Light Freight",
          career: "Transporter",
          size: "Small",
          crew_min: 1,
          crew_max: 1,
          kind: "spaceship",
        },
      ],
    });
  });

  it("keeps ground vehicles, skips power suits and broken entries", () => {
    const page = parseVehiclesPage({
      data: [
        vehicle({ uuid: "g", name: "Cyclone", is_spaceship: false, is_vehicle: true }),
        vehicle({ uuid: "p", name: "Power suit", is_spaceship: false, is_power_suit: true }),
        { name: "No uuid" },
      ],
      meta: { last_page: 1 },
    });
    expect(page.ok && page.rows.map((r) => [r.name, r.kind])).toEqual([["Cyclone", "ground"]]);
  });

  it("keeps one entry per ship, preferring the real one over a '-display' model", () => {
    const rows = dedupeShips([
      { ...(parseVehiclesPage({ data: [vehicle({ uuid: "d", slug: "aegs-avenger-titan-display" })] }) as any).rows[0] },
      { ...(parseVehiclesPage({ data: [vehicle({ uuid: "r" })] }) as any).rows[0] },
    ]);
    expect(rows.map((r) => r.wiki_uuid)).toEqual(["r"]);
  });

  it("changes nothing if the Wiki is down or answers strangely", async () => {
    expect(parseVehiclesPage({ error: "nope" }).ok).toBe(false);
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect((await fetchAllShips(down)).ok).toBe(false);
  });
});
