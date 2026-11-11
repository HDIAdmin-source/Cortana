import { checkBio, checkOrgMembership } from "../src/rsi";

/**
 * Live check that the RSI reader still understands RSI's pages. Not part of `pnpm test`
 * because it needs the internet and RSI being up. Run it if /verify starts failing:
 *   pnpm --filter @cortana/bot rsi-smoke <an RSI handle listed in the HDI org>
 */
const handle = process.argv[2];
const org = process.argv[3] ?? "OLDHUNTERS";
if (!handle) {
  console.error("Usage: pnpm --filter @cortana/bot rsi-smoke <rsi handle> [org tag]");
  process.exit(1);
}

const bio = await checkBio(handle, "HDI-ZZZZ"); // a code nobody has in their bio
const membership = await checkOrgMembership(org, handle);
console.log({ bio, membership });

const ok = bio.kind === "code_missing" && membership.kind === "member";
console.log(ok ? "RSI reader OK" : "RSI reader needs attention: RSI may have changed its pages");
process.exit(ok ? 0 : 1);
