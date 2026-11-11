/**
 * Reads public RSI pages for /verify (docs/SPEC.md, "RSI handle verification").
 *
 * Star Citizen has no official API, so this reads the same public pages a browser does.
 * When RSI changes its site this can break. Every function here therefore returns an
 * explicit "error" result instead of guessing, and callers must treat "error" as
 * "couldn't check": never as a failed verification, and never as a reason to change roles.
 */

const RSI = "https://robertsspaceindustries.com";
const HEADERS = { "user-agent": "CortanaBot/1.0 (HDI org tool)", accept: "text/html,application/json" };
const TIMEOUT_MS = 10_000;

export type BioResult =
  | { kind: "found" }
  | { kind: "code_missing" }
  | { kind: "no_such_citizen" }
  | { kind: "error"; reason: string };

export type OrgResult =
  | { kind: "member" }
  | { kind: "not_listed" }
  | { kind: "error"; reason: string };

/** Turn a bit of HTML into plain text for searching. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

/** Codes are matched ignoring case and stray spaces, so "hdi-7f3k" and "HDI - 7F3K" both count. */
function normaliseCode(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}

/** Parse a citizen profile page: is `code` in their bio? */
export function parseProfile(html: string, code: string): BioResult {
  // The "Handle name" label proves this is a profile page in the layout we expect.
  if (!/<span class="label">\s*Handle name\s*<\/span>/i.test(html)) {
    return { kind: "error", reason: "RSI profile page layout not recognised" };
  }
  const bio = html.match(/<div class="entry bio">[\s\S]*?<div class="value">([\s\S]*?)<\/div>/i);
  if (!bio) {
    return { kind: "code_missing" }; // profile without a bio
  }
  const text = normaliseCode(htmlToText(bio[1] ?? ""));
  return text.includes(normaliseCode(code)) ? { kind: "found" } : { kind: "code_missing" };
}

/** Parse the org member search response: is `handle` listed (publicly) in the org? */
export function parseOrgMembers(json: unknown, handle: string): OrgResult {
  const body = json as { success?: unknown; data?: { html?: unknown } } | null;
  if (!body || body.success !== 1 || typeof body.data?.html !== "string") {
    return { kind: "error", reason: "RSI org member list response not recognised" };
  }
  const wanted = handle.toLowerCase();
  const items = body.data.html.match(/<li class="member-item[\s\S]*?<\/li>/gi) ?? [];
  for (const item of items) {
    const nick = item.match(/<span class="[^"]*\bnick\b[^"]*">([^<]+)<\/span>/i)?.[1]?.trim();
    if (nick && nick.toLowerCase() === wanted) {
      return { kind: "member" };
    }
  }
  return { kind: "not_listed" };
}

export async function checkBio(handle: string, code: string, fetchImpl: typeof fetch = fetch): Promise<BioResult> {
  try {
    const res = await fetchImpl(`${RSI}/citizens/${encodeURIComponent(handle)}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return { kind: "no_such_citizen" };
    if (!res.ok) return { kind: "error", reason: `RSI profile page returned ${res.status}` };
    return parseProfile(await res.text(), code);
  } catch (err) {
    return { kind: "error", reason: `Could not reach RSI: ${(err as Error).message}` };
  }
}

export async function checkOrgMembership(
  orgSid: string,
  handle: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OrgResult> {
  try {
    const res = await fetchImpl(`${RSI}/api/orgs/getOrgMembers`, {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ symbol: orgSid, search: handle, pagesize: 32, page: 1 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { kind: "error", reason: `RSI org member list returned ${res.status}` };
    return parseOrgMembers(await res.json().catch(() => null), handle);
  } catch (err) {
    return { kind: "error", reason: `Could not reach RSI: ${(err as Error).message}` };
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

/** A one-time code such as HDI-7F3K. */
export function newVerificationCode(randomInt: (max: number) => number): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `HDI-${s}`;
}
