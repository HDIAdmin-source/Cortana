/**
 * Row types for the Cortana database, shared by the website and the bot.
 * They mirror supabase/migrations. If you change a table, change it here too.
 *
 * No initiative, division or rank NAME appears in code: those live in the
 * database (docs/SPEC.md, "Org model Cortana will store").
 */

export type Uuid = string;
/** ISO 8601 timestamp, always UTC. */
export type Timestamp = string;
/** YYYY-MM-DD */
export type DateString = string;

export type MemberStatus = "applicant" | "active" | "inactive" | "departed";
export type RankTier = "member" | "officer" | "director" | "chair";
export type AppointmentScope = "org" | "initiative" | "division";
export type UnitKind = "squadron" | "medical" | "other";
export type OperationStatus = "planned" | "live" | "completed" | "cancelled";
export type SignupStatus = "going" | "maybe" | "declined" | "attended";
export type ShipSource = "typed" | "import";

export interface Member {
  id: Uuid;
  auth_user_id: Uuid | null;
  discord_id: string;
  discord_name: string;
  rsi_handle: string | null;
  rsi_verified_at: Timestamp | null;
  status: MemberStatus;
  rank_id: Uuid | null;
  joined_at: Timestamp | null;
  timezone: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Initiative {
  id: Uuid;
  slug: string;
  name: string;
  motto_greek: string | null;
  motto_en: string | null;
  remit: string | null;
  emoji_id: string | null;
  discord_role_id: string | null;
  discord_role_name: string | null;
  rank_role_prefix: string | null;
  is_home: boolean;
  sort_order: number;
}

export interface Division {
  id: Uuid;
  initiative_id: Uuid;
  parent_division_id: Uuid | null;
  slug: string;
  name: string;
  description: string | null;
  discord_role_id: string | null;
  discord_role_name: string | null;
  sort_order: number;
}

export interface Rank {
  id: Uuid;
  name: string;
  tier: RankTier;
  sort_order: number;
  description: string | null;
  /** Discord role ID per home initiative, keyed by initiative slug. */
  discord_role_ids: Record<string, string>;
}

export interface MemberAssignment {
  id: Uuid;
  member_id: Uuid;
  initiative_id: Uuid;
  division_id: Uuid | null;
  unit_id: Uuid | null;
  /** true for the home initiative, false for Auxiliary divisions. */
  is_primary: boolean;
}

export interface Appointment {
  id: Uuid;
  member_id: Uuid;
  title: string;
  scope: AppointmentScope;
  /** Initiative or division id; null when scope is "org". */
  scope_id: Uuid | null;
  starts_on: DateString;
  review_on: DateString | null;
  ends_on: DateString | null;
  granted_by: Uuid | null;
}

export interface Unit {
  id: Uuid;
  division_id: Uuid;
  name: string;
  kind: UnitKind;
  lead_member_id: Uuid | null;
  discord_role_id: string | null;
  discord_role_name: string | null;
}

export interface Award {
  id: Uuid;
  name: string;
  description: string | null;
  discord_role_id: string | null;
  discord_role_name: string | null;
}

export interface MemberAward {
  id: Uuid;
  member_id: Uuid;
  award_id: Uuid;
  awarded_on: DateString;
  awarded_by: Uuid | null;
  citation: string | null;
}

export interface Operation {
  id: Uuid;
  name: string;
  objective: string | null;
  lead_initiative_id: Uuid | null;
  commander_id: Uuid | null;
  starts_at: Timestamp;
  staging: string | null;
  comms_channel: string | null;
  status: OperationStatus;
  after_action: string | null;
  is_public: boolean;
}

export interface OpSignup {
  id: Uuid;
  operation_id: Uuid;
  member_id: Uuid;
  role: string | null;
  ship_id: Uuid | null;
  status: SignupStatus;
}

export interface Ship {
  id: Uuid;
  name: string;
  manufacturer: string | null;
  wiki_uuid: string | null;
  role: string | null;
  crew_min: number | null;
  crew_max: number | null;
}

export interface MemberShip {
  id: Uuid;
  member_id: Uuid;
  ship_id: Uuid;
  source: ShipSource;
  available_for_ops: boolean;
}

export interface RankHistory {
  id: Uuid;
  member_id: Uuid;
  from_rank: Uuid | null;
  to_rank: Uuid | null;
  reason: string | null;
  approved_by: Uuid | null;
  at: Timestamp;
}

export interface AuditLogEntry {
  id: number;
  actor_id: Uuid | null;
  actor_role: string | null;
  action: "insert" | "update" | "delete";
  table_name: string;
  row_id: Uuid | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: Timestamp;
}
