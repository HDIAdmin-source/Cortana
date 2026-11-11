/**
 * Ops are stored and entered in UTC (docs/SPEC.md); Discord timestamps then show each
 * member the time in their own time zone.
 */

/** Parse "2026-11-20 19:00" (optionally with "UTC" or "Z") as a UTC time. */
export function parseUtc(input: string): Date | null {
  const m = input.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})\s*(?:UTC|Z)?$/i);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // Reject impossible dates like 2026-02-31 (Date would roll them over).
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || h > 23) return null;
  return date;
}

/** Discord timestamp markup: F = full date and time, R = relative ("in 3 hours"), f = short. */
export function discordTime(iso: string | Date, style: "F" | "f" | "R" | "t" | "D" = "F"): string {
  const ms = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

/** "2026-11-20 19:00 UTC" */
export function formatUtc(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
