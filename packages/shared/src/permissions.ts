import type { RankTier } from "./types";

/**
 * The four permission levels from docs/SPEC.md ("Permission levels").
 *
 * The DATABASE enforces these (row-level security in supabase/migrations).
 * This helper is only for deciding which buttons/commands to show; never rely
 * on it to protect data.
 */
export type PermissionLevel = "member" | "officer" | "director" | "admin";

const LEVEL_ORDER: PermissionLevel[] = ["member", "officer", "director", "admin"];

/** The level a rank tier gives on its own (Admin comes from an org-wide appointment, not a rank). */
export function levelForTier(tier: RankTier): PermissionLevel {
  switch (tier) {
    case "member":
      return "member";
    case "officer":
      return "officer";
    case "director":
    case "chair":
      return "director";
  }
}

export function atLeast(level: PermissionLevel, required: PermissionLevel): boolean {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(required);
}
