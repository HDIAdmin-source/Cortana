-- Cortana Phase 1: the fifteen version-1 tables from docs/SPEC.md, "Data model".
-- No initiative, division or rank NAME is written here; those come from supabase/seed.sql.

-- ---------------------------------------------------------------------------
-- Value lists
-- ---------------------------------------------------------------------------
create type public.member_status    as enum ('applicant', 'active', 'inactive', 'departed');
-- What a rank allows, independent of its name (see "Permission levels"):
--   member   = Hoplite..Prefect, officer = Praetor, Centurion,
--   director = Director, chair = Chair of an initiative.
create type public.rank_tier        as enum ('member', 'officer', 'director', 'chair');
create type public.appointment_scope as enum ('org', 'initiative', 'division');
create type public.unit_kind        as enum ('squadron', 'medical', 'other');
create type public.operation_status as enum ('planned', 'live', 'completed', 'cancelled');
create type public.signup_status    as enum ('going', 'maybe', 'declined', 'attended');
create type public.ship_source      as enum ('typed', 'import');

-- ---------------------------------------------------------------------------
-- Org structure
-- ---------------------------------------------------------------------------
create table public.ranks (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  tier             public.rank_tier not null,
  sort_order       int  not null unique,          -- 1 = lowest
  description      text,
  discord_role_ids jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
comment on column public.ranks.discord_role_ids is
  'Discord role ID for this rank in each home initiative, keyed by initiative slug, e.g. {"helios": "123..."} for H-Operator. Filled by /setup roles.';

create table public.initiatives (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name              text not null unique,
  motto_greek       text,
  motto_en          text,
  remit             text,
  emoji_id          text,
  discord_role_id   text,
  discord_role_name text,      -- live role name, used by /setup roles to find discord_role_id
  rank_role_prefix  text,      -- 'H-', 'E-', 'S-'; null for Auxiliary (no rank ladder)
  is_home           boolean not null default true,   -- false for Auxiliary
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);

create table public.divisions (
  id                 uuid primary key default gen_random_uuid(),
  initiative_id      uuid not null references public.initiatives (id) on delete restrict,
  parent_division_id uuid references public.divisions (id) on delete restrict, -- null = top-level division
  slug               text not null check (slug ~ '^[a-z0-9-]+$'),
  name               text not null,
  description        text,
  discord_role_id    text,
  discord_role_name  text,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  unique (initiative_id, slug),
  check (parent_division_id is distinct from id)
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.members (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid unique references auth.users (id) on delete set null, -- their "Log in with Discord" account
  discord_id      text not null unique,
  discord_name    text not null,
  rsi_handle      text,
  rsi_verified_at timestamptz,
  status          public.member_status not null default 'applicant',
  rank_id         uuid references public.ranks (id) on delete restrict,
  joined_at       timestamptz,
  timezone        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index members_rsi_handle_key on public.members (lower(rsi_handle)) where rsi_handle is not null;
create index members_rank_idx on public.members (rank_id);

create table public.units (
  id                uuid primary key default gen_random_uuid(),
  division_id       uuid not null references public.divisions (id) on delete restrict,
  name              text not null,
  kind              public.unit_kind not null default 'other',
  lead_member_id    uuid references public.members (id) on delete set null,
  discord_role_id   text,
  discord_role_name text,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  unique (division_id, name)
);

create table public.member_assignments (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members (id) on delete cascade,
  initiative_id uuid not null references public.initiatives (id) on delete restrict,
  division_id   uuid references public.divisions (id) on delete restrict,
  unit_id       uuid references public.units (id) on delete set null,
  is_primary    boolean not null default false,  -- true = home initiative (carries rank); false = Auxiliary
  created_at    timestamptz not null default now()
);
-- Exactly one home initiative per member.
create unique index member_assignments_one_primary on public.member_assignments (member_id) where is_primary;
create index member_assignments_member_idx on public.member_assignments (member_id);

create table public.appointments (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  title      text not null,                       -- e.g. 'Industry Division Director'
  scope      public.appointment_scope not null,
  scope_id   uuid,                                -- initiative or division id; null when scope = 'org'
  starts_on  date not null default current_date,
  review_on  date,
  ends_on    date,
  granted_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((scope = 'org') = (scope_id is null)),
  check (ends_on is null or ends_on >= starts_on)
);
comment on table public.appointments is
  'Director and lead posts. An active appointment with scope = org gives Admin level (the owner and =The High Table=).';
create index appointments_member_idx on public.appointments (member_id);

-- ---------------------------------------------------------------------------
-- Awards
-- ---------------------------------------------------------------------------
create table public.awards (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  description       text,
  discord_role_id   text,
  discord_role_name text,
  created_at        timestamptz not null default now()
);

create table public.member_awards (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  award_id   uuid not null references public.awards (id) on delete restrict,
  awarded_on date not null default current_date,
  awarded_by uuid references public.members (id) on delete set null,
  citation   text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ships and operations
-- ---------------------------------------------------------------------------
create table public.ships (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  manufacturer text,
  wiki_uuid    text unique,          -- id from api.star-citizen.wiki
  role         text,
  crew_min     int check (crew_min is null or crew_min >= 0),
  crew_max     int check (crew_max is null or crew_max >= 0),
  updated_at   timestamptz not null default now()
);

create table public.member_ships (
  id                uuid primary key default gen_random_uuid(),
  member_id         uuid not null references public.members (id) on delete cascade,
  ship_id           uuid not null references public.ships (id) on delete restrict,
  source            public.ship_source not null default 'typed',
  available_for_ops boolean not null default false,
  created_at        timestamptz not null default now()
);
create index member_ships_member_idx on public.member_ships (member_id);

create table public.operations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  objective          text,
  lead_initiative_id uuid references public.initiatives (id) on delete set null,
  commander_id       uuid references public.members (id) on delete set null,
  starts_at          timestamptz not null,          -- stored in UTC
  staging            text,
  comms_channel      text,
  status             public.operation_status not null default 'planned',
  after_action       text,
  is_public          boolean not null default false, -- after-action shown on the public site only if true
  created_at         timestamptz not null default now()
);

create table public.op_signups (
  id           uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations (id) on delete cascade,
  member_id    uuid not null references public.members (id) on delete cascade,
  role         text,
  ship_id      uuid references public.ships (id) on delete set null,
  status       public.signup_status not null default 'going',
  created_at   timestamptz not null default now(),
  unique (operation_id, member_id)
);

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------
create table public.rank_history (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members (id) on delete cascade,
  from_rank   uuid references public.ranks (id) on delete set null,
  to_rank     uuid references public.ranks (id) on delete set null,
  reason      text,
  approved_by uuid references public.members (id) on delete set null,
  at          timestamptz not null default now()
);
create index rank_history_member_idx on public.rank_history (member_id);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.members (id) on delete set null,  -- null = the bot/service or a migration
  actor_role text,                                                    -- database role the change came through
  action     text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  row_id     uuid,
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now()
);
create index audit_log_row_idx on public.audit_log (table_name, row_id);

-- ---------------------------------------------------------------------------
-- Integrity checks that a simple foreign key can't express
-- ---------------------------------------------------------------------------
create function public.validate_assignment() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_division_initiative uuid;
  v_unit_division uuid;
  v_is_home boolean;
begin
  if new.division_id is not null then
    select initiative_id into v_division_initiative from public.divisions where id = new.division_id;
    if v_division_initiative is distinct from new.initiative_id then
      raise exception 'That division does not belong to that initiative';
    end if;
  end if;

  if new.unit_id is not null then
    select division_id into v_unit_division from public.units where id = new.unit_id;
    if new.division_id is null or v_unit_division is distinct from new.division_id then
      raise exception 'That unit does not belong to that division';
    end if;
  end if;

  if new.is_primary then
    select is_home into v_is_home from public.initiatives where id = new.initiative_id;
    if not coalesce(v_is_home, false) then
      raise exception 'A member''s primary (home) assignment must be a home initiative';
    end if;
  end if;

  return new;
end $$;

create trigger member_assignments_validate
  before insert or update on public.member_assignments
  for each row execute function public.validate_assignment();

create function public.validate_appointment() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.scope = 'initiative' and not exists (select 1 from public.initiatives where id = new.scope_id) then
    raise exception 'Appointment scope_id is not an initiative';
  elsif new.scope = 'division' and not exists (select 1 from public.divisions where id = new.scope_id) then
    raise exception 'Appointment scope_id is not a division';
  end if;
  return new;
end $$;

create trigger appointments_validate
  before insert or update on public.appointments
  for each row execute function public.validate_appointment();

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger members_touch_updated_at
  before update on public.members
  for each row execute function public.touch_updated_at();
