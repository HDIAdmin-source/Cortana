import { fetchAllShips, WIKI_CREDIT } from "../src/wiki";

/**
 * Live check that the Star Citizen Wiki reader still understands the API. Not part of
 * `pnpm test` because it needs the internet. Run it if /setup ships starts failing:
 *   pnpm --filter @cortana/bot wiki-smoke
 */
const result = await fetchAllShips();
if (!result.ok) {
  console.error("Wiki reader needs attention:", result.reason);
  process.exit(1);
}
const ground = result.rows.filter((r) => r.kind === "ground").length;
console.log(`Wiki reader OK: ${result.rows.length} ships and vehicles (${ground} ground). ${WIKI_CREDIT}`);
console.log("Sample:", result.rows.slice(0, 3).map((r) => `${r.name} (${r.manufacturer}, ${r.role}, crew ${r.crew_min}-${r.crew_max})`));
