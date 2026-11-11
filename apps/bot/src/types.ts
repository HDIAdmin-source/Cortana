/** Shapes returned by the bot_* database functions (supabase/migrations/20261112000001_phase2_bot.sql). */

export interface WhoAmI {
  in_cortana: boolean;
  member_id?: string;
  status?: string;
  verified?: boolean;
  is_member?: boolean;
  is_officer?: boolean;
  is_director?: boolean;
  is_admin?: boolean;
}

export interface RoleState {
  in_cortana: boolean;
  desired?: string[];
  managed?: string[];
}

export interface RoleTarget {
  kind: "initiative" | "division" | "unit" | "rank" | "member_role";
  id: string | null;
  slug: string | null;
  label: string;
  expected_name: string | null;
  role_id: string | null;
}

export interface RoleLink {
  kind: RoleTarget["kind"];
  id: string | null;
  slug: string | null;
  role_id: string;
}

export interface PendingVerification {
  code_id: string;
  code: string;
  rsi_handle: string;
  expires_at: string;
}

export interface PendingPromotion {
  id: string;
  discord_id: string;
  discord_name: string;
  from_rank: string | null;
  to_rank: string;
  reason: string;
  proposed_by: string | null;
  created_at: string;
}

export interface Profile {
  discord_id: string;
  discord_name: string;
  status: string;
  rsi_handle: string | null;
  verified: boolean;
  joined_at: string | null;
  timezone: string | null;
  rank: string | null;
  assignments: { primary: boolean; initiative: string; division: string | null; unit: string | null }[];
  appointments: { title: string; scope: string | null; review_on: string | null }[];
  awards: { name: string; awarded_on: string }[];
}

export interface RosterEntry {
  discord_id: string;
  discord_name: string;
  rank: string | null;
  rank_order: number | null;
  home: string | null;
}
