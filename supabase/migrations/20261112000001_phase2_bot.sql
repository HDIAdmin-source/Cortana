-- Cortana Phase 2: what the Discord bot needs (docs/SPEC.md, "Discord bot, version 1" and the
-- owner answers of 11 November 2026).
--
-- The bot connects with the service-role key, which bypasses row-level security. So that the
-- permission rules still live in the database, every bot ACTION goes through one of the bot_*
-- functions below. Each takes the Discord ID of the person who ran the command, checks what
-- that person is allowed to do, makes the change, and records them as the actor in audit_log.
-- Only the service role can call bot_* functions.

-- ---------------------------------------------------------------------------
-- 1. New data
-- ---------------------------------------------------------------------------

-- Organisation-wide settings. Exactly one row.
create table public.org_settings (
  id               boolean primary key default true check (id),
  rsi_org_sid      text not null,   -- RSI org tag used by /verify, e.g. OLDHUNTERS
  member_role_name text,            -- Discord role every active member gets, e.g. HDI
  member_role_id   text,            -- filled by /setup roles
  updated_at       timestamptz not null default now()
);

-- The initiative an applicant asked for in /enlist (their real home is set by /assign).
alter table public.members
  add column interested_initiative_id uuid references public.initiatives (id) on delete set null;

-- Owner decision: division leaders approve promotions to these ranks; higher ranks need an Admin.
alter table public.ranks
  add column leader_can_approve boolean not null default false;

-- How this rank's Discord role is named, per home initiative.
-- {prefix} = the initiative's rank_role_prefix (H-, E-, S-), {rank} = rank name, {initiative} = initiative name.
alter table public.ranks
  add column discord_role_name_pattern text;

create type public.promotion_status as enum ('pending', 'approved', 'rejected');

-- A promotion a Director or Chair proposed that needs an Admin's approval.
create table public.promotion_requests (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members (id) on delete cascade,
  from_rank   uuid references public.ranks (id) on delete set null,
  to_rank     uuid not null references public.ranks (id) on delete restrict,
  reason      text not null,
  proposed_by uuid references public.members (id) on delete set null,
  status      public.promotion_status not null default 'pending',
  decided_by  uuid references public.members (id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index promotion_requests_one_pending on public.promotion_requests (member_id) where status = 'pending';

-- One-time codes for the RSI bio check (/verify).
create table public.verification_codes (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  rsi_handle text not null,
  code       text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index verification_codes_member_idx on public.verification_codes (member_id);

grant select, insert, update, delete on public.org_settings, public.promotion_requests, public.verification_codes to authenticated;
grant all on public.org_settings, public.promotion_requests, public.verification_codes to service_role;

alter table public.org_settings       enable row level security;
alter table public.promotion_requests enable row level security;
alter table public.verification_codes enable row level security;  -- no policies: bot only

create policy "Members read org settings" on public.org_settings
  for select to authenticated using (true);
create policy "Admins manage org settings" on public.org_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Read own, proposed or (admins) all promotion requests" on public.promotion_requests
  for select to authenticated
  using (
    member_id = public.current_member_id()
    or proposed_by = public.current_member_id()
    or public.is_admin()
  );

-- ---------------------------------------------------------------------------
-- 2. Who did it? Logged-in website users are identified by their login; the bot names the
--    person who ran the command through the transaction-local setting cortana.actor_id.
-- ---------------------------------------------------------------------------
create function public.acting_member_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    public.current_member_id(),
    nullif(current_setting('cortana.actor_id', true), '')::uuid
  )
$$;

create or replace function public.audit_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_id     text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after  := to_jsonb(new); end if;

  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  v_id := coalesce(v_after ->> 'id', v_before ->> 'id');

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, before, after)
  values (
    public.acting_member_id(),
    nullif(current_setting('role', true), 'none'),
    lower(tg_op),
    tg_table_name,
    case when v_id ~ '^[0-9a-fA-F-]{36}$' then v_id::uuid end,
    v_before,
    v_after
  );
  return null;
end $$;

-- Now credits the bot's actor too, and also handles inserts (a member's first rank).
create or replace function public.log_rank_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_from uuid;
begin
  if tg_op = 'UPDATE' then
    v_from := old.rank_id;
  end if;
  insert into public.rank_history (member_id, from_rank, to_rank, reason, approved_by)
  values (
    new.id,
    v_from,
    new.rank_id,
    nullif(current_setting('cortana.change_reason', true), ''),
    public.acting_member_id()
  );
  return null;
end $$;

create trigger members_rank_history_insert
  after insert on public.members
  for each row
  when (new.rank_id is not null)
  execute function public.log_rank_change();

-- Org structure edits are sensitive too.
create trigger initiatives_audit        after insert or update or delete on public.initiatives        for each row execute function public.audit_change();
create trigger divisions_audit          after insert or update or delete on public.divisions          for each row execute function public.audit_change();
create trigger units_audit              after insert or update or delete on public.units              for each row execute function public.audit_change();
create trigger org_settings_audit       after insert or update or delete on public.org_settings       for each row execute function public.audit_change();
create trigger promotion_requests_audit after insert or update or delete on public.promotion_requests for each row execute function public.audit_change();

-- ---------------------------------------------------------------------------
-- 3. Permission checks for a given member (the Phase 1 checks now reuse these).
-- ---------------------------------------------------------------------------
create function public.member_is_admin(p_member uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.members m
    join public.appointments a on a.member_id = m.id
    where m.id = p_member
      and m.status = 'active'
      and a.scope = 'org'
      and a.starts_on <= current_date
      and (a.ends_on is null or a.ends_on > current_date)
  )
$$;

create function public.member_is_officer(p_member uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.member_is_admin(p_member) or exists (
    select 1
    from public.members m
    join public.ranks r on r.id = m.rank_id
    where m.id = p_member
      and m.status = 'active'
      and r.tier in ('officer', 'director', 'chair')
  )
$$;

create function public.member_is_director(p_member uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.members m
    join public.ranks r on r.id = m.rank_id
    join public.appointments a on a.member_id = m.id
    where m.id = p_member
      and m.status = 'active'
      and r.tier in ('director', 'chair')
      and a.scope in ('initiative', 'division')
      and a.starts_on <= current_date
      and (a.ends_on is null or a.ends_on > current_date)
  )
$$;

create function public.member_can_direct(p_member uuid, p_initiative_id uuid, p_division_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.members m
    join public.ranks r on r.id = m.rank_id
    join public.appointments a on a.member_id = m.id
    where m.id = p_member
      and m.status = 'active'
      and r.tier in ('director', 'chair')
      and a.starts_on <= current_date
      and (a.ends_on is null or a.ends_on > current_date)
      and (
        (a.scope = 'initiative' and a.scope_id = p_initiative_id)
        or (
          a.scope = 'division'
          and p_division_id is not null
          and a.scope_id in (
            with recursive up as (
              select d.id, d.parent_division_id from public.divisions d where d.id = p_division_id
              union all
              select d.id, d.parent_division_id from public.divisions d join up on d.id = up.parent_division_id
            )
            select id from up
          )
        )
      )
  )
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.member_is_admin(public.current_member_id())
$$;

create or replace function public.can_direct(p_initiative_id uuid, p_division_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.member_can_direct(public.current_member_id(), p_initiative_id, p_division_id)
$$;

-- Can p_actor move p_target to p_to_rank?  'approve' = do it now, 'propose' = needs an Admin,
-- 'deny' = not allowed. Owner decision 11 Nov 2026: Directors (in their division) and Chairs
-- (in their initiative) approve promotions up to the ranks marked leader_can_approve; above
-- that they propose. Demotions are Admin-only. Nobody changes their own rank.
create function public.member_promotion_right(p_actor uuid, p_target uuid, p_to_rank uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_from_order int;
  v_to_order   int;
  v_leader_ok  boolean;
  v_home_init  uuid;
  v_home_div   uuid;
begin
  if p_actor is null or p_target is null or p_actor = p_target then
    return 'deny';
  end if;
  if public.member_is_admin(p_actor) then
    return 'approve';
  end if;

  select r.sort_order into v_from_order
  from public.members m left join public.ranks r on r.id = m.rank_id
  where m.id = p_target;

  select sort_order, leader_can_approve into v_to_order, v_leader_ok
  from public.ranks where id = p_to_rank;

  if v_to_order is null then return 'deny'; end if;
  if v_from_order is not null and v_to_order <= v_from_order then
    return 'deny';  -- demotion or no change: Admin only
  end if;

  select initiative_id, division_id into v_home_init, v_home_div
  from public.member_assignments where member_id = p_target and is_primary;
  if v_home_init is null then return 'deny'; end if;

  if not public.member_can_direct(p_actor, v_home_init, v_home_div) then
    return 'deny';
  end if;

  return case when v_leader_ok then 'approve' else 'propose' end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Discord roles: which managed roles a member should hold.
-- ---------------------------------------------------------------------------

-- Every Discord role Cortana manages. The bot never adds or removes any other role.
create function public.managed_role_ids() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct rid), '{}')
  from (
    select discord_role_id as rid from public.initiatives
    union all select discord_role_id from public.divisions
    union all select discord_role_id from public.units
    union all select value from public.ranks, jsonb_each_text(discord_role_ids)
    union all select member_role_id from public.org_settings
  ) x
  where rid is not null and rid <> ''
$$;

-- The managed roles this member should have right now. Only active members get any.
create function public.member_desired_role_ids(p_member uuid) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  with m as (
    select * from public.members where id = p_member and status = 'active'
  ),
  a as (
    select ma.* from public.member_assignments ma join m on m.id = ma.member_id
  )
  select coalesce(array_agg(distinct rid), '{}')
  from (
    select i.discord_role_id as rid from a join public.initiatives i on i.id = a.initiative_id
    union all select d.discord_role_id from a join public.divisions d on d.id = a.division_id
    union all select u.discord_role_id from a join public.units u on u.id = a.unit_id
    union all
      select r.discord_role_ids ->> i.slug
      from m
      join public.ranks r on r.id = m.rank_id
      join a on a.is_primary
      join public.initiatives i on i.id = a.initiative_id
    union all select s.member_role_id from public.org_settings s, m
  ) x
  where rid is not null and rid <> ''
$$;

-- ---------------------------------------------------------------------------
-- 5. Functions the bot calls (service role only).
-- ---------------------------------------------------------------------------
create function public.bot_member_id(p_discord_id text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.members where discord_id = p_discord_id
$$;

-- Records who is acting for audit_log / rank_history, and returns their member id (or null).
create function public.bot_set_actor(p_discord_id text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v uuid := public.bot_member_id(p_discord_id);
begin
  perform set_config('cortana.actor_id', coalesce(v::text, ''), true);
  return v;
end $$;

create function public.valid_rsi_handle(p_handle text) returns boolean
language sql immutable as $$
  select p_handle is not null and p_handle ~ '^[A-Za-z0-9_-]{3,60}$'
$$;

-- What the person running a command is allowed to do.
create function public.bot_whoami(p_discord_id text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when m.id is null then jsonb_build_object('in_cortana', false)
    else jsonb_build_object(
      'in_cortana', true,
      'member_id', m.id,
      'status', m.status,
      'verified', m.rsi_verified_at is not null,
      'is_member', m.status = 'active' and m.rsi_verified_at is not null,
      'is_officer', public.member_is_officer(m.id),
      'is_director', public.member_is_director(m.id),
      'is_admin', public.member_is_admin(m.id)
    )
  end
  from (select 1) one
  left join public.members m on m.discord_id = p_discord_id
$$;

-- /enlist: start an application.
create function public.bot_enlist(
  p_discord_id text, p_discord_name text, p_rsi_handle text, p_timezone text, p_initiative_slug text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.members;
  v_init     public.initiatives;
  v_id       uuid := gen_random_uuid();
begin
  select * into v_existing from public.members where discord_id = p_discord_id;
  if found then
    return jsonb_build_object('status', 'exists', 'member_status', v_existing.status);
  end if;

  select * into v_init from public.initiatives where slug = p_initiative_slug;
  if not found or not v_init.is_home then
    raise exception 'Pick one of the home initiatives to enlist into';
  end if;

  if not public.valid_rsi_handle(p_rsi_handle) then
    raise exception 'That doesn''t look like an RSI handle (letters, numbers, - and _ only)';
  end if;
  if exists (select 1 from public.members where lower(rsi_handle) = lower(p_rsi_handle)) then
    raise exception 'That RSI handle is already linked to another member. Ask an Admin if this is wrong';
  end if;

  perform set_config('cortana.actor_id', v_id::text, true);
  insert into public.members (id, discord_id, discord_name, rsi_handle, timezone, status, interested_initiative_id)
  values (v_id, p_discord_id, p_discord_name, p_rsi_handle, p_timezone, 'applicant', v_init.id);

  return jsonb_build_object('status', 'created', 'member_id', v_id, 'initiative', v_init.name);
end $$;

-- /verify handle: store a one-time code (generated by the bot) for this handle.
create function public.bot_start_verification(p_discord_id text, p_rsi_handle text, p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member uuid := public.bot_set_actor(p_discord_id);
  v_expires timestamptz := now() + interval '24 hours';
begin
  if v_member is null then
    raise exception 'You''re not in Cortana yet. Run /enlist first';
  end if;
  if not public.valid_rsi_handle(p_rsi_handle) then
    raise exception 'That doesn''t look like an RSI handle (letters, numbers, - and _ only)';
  end if;
  if exists (select 1 from public.members where lower(rsi_handle) = lower(p_rsi_handle) and id <> v_member) then
    raise exception 'That RSI handle is already linked to another member. Ask an Admin if this is wrong';
  end if;

  delete from public.verification_codes where member_id = v_member and used_at is null;
  insert into public.verification_codes (member_id, rsi_handle, code, expires_at)
  values (v_member, p_rsi_handle, p_code, v_expires);

  return jsonb_build_object('code', p_code, 'rsi_handle', p_rsi_handle, 'expires_at', v_expires);
end $$;

-- /verify check: the code waiting to be found, or null.
create function public.bot_pending_verification(p_discord_id text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('code_id', v.id, 'code', v.code, 'rsi_handle', v.rsi_handle, 'expires_at', v.expires_at)
  from public.verification_codes v
  join public.members m on m.id = v.member_id
  where m.discord_id = p_discord_id and v.used_at is null and v.expires_at > now()
  order by v.created_at desc
  limit 1
$$;

-- /verify check passed (the bot found the code in the bio and the handle in the org list).
create function public.bot_complete_verification(p_discord_id text, p_code_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member uuid := public.bot_set_actor(p_discord_id);
  v_code   public.verification_codes;
begin
  select * into v_code from public.verification_codes
  where id = p_code_id and member_id = v_member and used_at is null and expires_at > now();
  if not found then
    raise exception 'That verification code has expired. Run /verify handle again';
  end if;
  if exists (select 1 from public.members where lower(rsi_handle) = lower(v_code.rsi_handle) and id <> v_member) then
    raise exception 'That RSI handle is already linked to another member. Ask an Admin if this is wrong';
  end if;

  update public.members set rsi_handle = v_code.rsi_handle, rsi_verified_at = now() where id = v_member;
  update public.verification_codes set used_at = now() where id = v_code.id;

  return jsonb_build_object(
    'rsi_handle', v_code.rsi_handle,
    'status', (select status from public.members where id = v_member)
  );
end $$;

-- /verify manual: an Admin verifies someone the automatic check can't (e.g. hidden org membership).
create function public.bot_manual_verify(p_actor_discord text, p_target_discord text, p_rsi_handle text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor  uuid := public.bot_set_actor(p_actor_discord);
  v_target uuid := public.bot_member_id(p_target_discord);
begin
  if not public.member_is_admin(v_actor) then
    raise exception 'Only an Admin can verify someone by hand' using errcode = '42501';
  end if;
  if v_target is null then
    raise exception 'That person isn''t in Cortana. They need to run /enlist first';
  end if;
  if not public.valid_rsi_handle(p_rsi_handle) then
    raise exception 'That doesn''t look like an RSI handle (letters, numbers, - and _ only)';
  end if;
  if exists (select 1 from public.members where lower(rsi_handle) = lower(p_rsi_handle) and id <> v_target) then
    raise exception 'That RSI handle is already linked to another member';
  end if;

  update public.members set rsi_handle = p_rsi_handle, rsi_verified_at = now() where id = v_target;
  delete from public.verification_codes where member_id = v_target and used_at is null;
  return jsonb_build_object('rsi_handle', p_rsi_handle);
end $$;

-- /assign: set a member's home initiative/division/unit, or add/remove an Auxiliary division.
-- Assigning a verified applicant to a home initiative accepts them: active, entry rank.
create function public.bot_assign(
  p_actor_discord text, p_target_discord text,
  p_initiative_slug text, p_division_slug text, p_unit_name text, p_remove boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor      uuid := public.bot_set_actor(p_actor_discord);
  v_admin      boolean;
  v_target     public.members;
  v_init       public.initiatives;
  v_div        uuid;
  v_unit       uuid;
  v_home       public.member_assignments;
  v_entry_rank public.ranks;
  v_accepted   boolean := false;
begin
  if v_actor is null then
    raise exception 'You''re not in Cortana' using errcode = '42501';
  end if;
  v_admin := public.member_is_admin(v_actor);

  select * into v_target from public.members where discord_id = p_target_discord;
  if not found then
    raise exception 'That person isn''t in Cortana. They need to run /enlist first';
  end if;

  select * into v_init from public.initiatives where slug = p_initiative_slug;
  if not found then
    raise exception 'Unknown initiative';
  end if;

  if p_division_slug is not null then
    select id into v_div from public.divisions where initiative_id = v_init.id and slug = p_division_slug;
    if v_div is null then
      raise exception 'That division isn''t part of %', v_init.name;
    end if;
  end if;

  if p_unit_name is not null then
    if v_div is null then
      raise exception 'Pick the unit''s division as well';
    end if;
    select id into v_unit from public.units where division_id = v_div and lower(name) = lower(p_unit_name);
    if v_unit is null then
      raise exception 'That unit isn''t part of that division';
    end if;
  end if;

  if not (v_admin or public.member_can_direct(v_actor, v_init.id, v_div)) then
    raise exception 'You can only assign members inside your own initiative or division' using errcode = '42501';
  end if;

  if v_init.is_home then
    if coalesce(p_remove, false) then
      raise exception 'A home initiative can''t be removed, only changed. Assign their new home initiative instead';
    end if;
    if v_target.status = 'applicant' and v_target.rsi_verified_at is null then
      raise exception 'They need to pass /verify before they can be accepted';
    end if;

    select * into v_home from public.member_assignments where member_id = v_target.id and is_primary;
    if found then
      if not (v_admin or public.member_can_direct(v_actor, v_home.initiative_id, v_home.division_id)) then
        raise exception 'They currently belong to an initiative or division you don''t lead' using errcode = '42501';
      end if;
      update public.member_assignments
         set initiative_id = v_init.id, division_id = v_div, unit_id = v_unit
       where id = v_home.id;
    else
      insert into public.member_assignments (member_id, initiative_id, division_id, unit_id, is_primary)
      values (v_target.id, v_init.id, v_div, v_unit, true);
    end if;

    if v_target.status = 'applicant' then
      select * into v_entry_rank from public.ranks order by sort_order limit 1;
      perform set_config('cortana.change_reason', 'Accepted into ' || v_init.name, true);
      update public.members
         set status = 'active',
             joined_at = coalesce(joined_at, now()),
             rank_id = coalesce(rank_id, v_entry_rank.id)
       where id = v_target.id;
      v_accepted := true;
    end if;
  else
    if v_target.status <> 'active' then
      raise exception 'Only active members can join % divisions', v_init.name;
    end if;
    if v_div is null then
      raise exception 'Pick which % division', v_init.name;
    end if;

    if coalesce(p_remove, false) then
      delete from public.member_assignments
       where member_id = v_target.id and initiative_id = v_init.id and division_id = v_div and not is_primary;
      if not found then
        raise exception 'They weren''t in that division';
      end if;
    else
      update public.member_assignments
         set unit_id = v_unit
       where member_id = v_target.id and initiative_id = v_init.id and division_id = v_div and not is_primary;
      if not found then
        insert into public.member_assignments (member_id, initiative_id, division_id, unit_id, is_primary)
        values (v_target.id, v_init.id, v_div, v_unit, false);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'accepted', v_accepted,
    'initiative', v_init.name,
    'rank', (select r.name from public.members m join public.ranks r on r.id = m.rank_id where m.id = v_target.id)
  );
end $$;

-- /promote: change a rank now, or propose it for an Admin.
create function public.bot_promote(p_actor_discord text, p_target_discord text, p_rank_name text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor  uuid := public.bot_set_actor(p_actor_discord);
  v_target public.members;
  v_rank   public.ranks;
  v_right  text;
  v_req    uuid;
  v_cap    text;
begin
  if v_actor is null then
    raise exception 'You''re not in Cortana' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required for a rank change';
  end if;

  select * into v_target from public.members where discord_id = p_target_discord;
  if not found then
    raise exception 'That person isn''t in Cortana';
  end if;
  if v_target.status <> 'active' then
    raise exception 'Only active members can be promoted. Use /assign to accept an applicant first';
  end if;

  select * into v_rank from public.ranks where lower(name) = lower(p_rank_name);
  if not found then
    raise exception 'Unknown rank';
  end if;
  if v_target.rank_id = v_rank.id then
    raise exception 'They already hold that rank';
  end if;

  v_right := public.member_promotion_right(v_actor, v_target.id, v_rank.id);

  if v_right = 'approve' then
    perform set_config('cortana.change_reason', p_reason, true);
    update public.members set rank_id = v_rank.id where id = v_target.id;
    return jsonb_build_object('result', 'changed', 'rank', v_rank.name);
  elsif v_right = 'propose' then
    if exists (select 1 from public.promotion_requests where member_id = v_target.id and status = 'pending') then
      raise exception 'There''s already a pending promotion for them. An Admin needs to decide it first';
    end if;
    insert into public.promotion_requests (member_id, from_rank, to_rank, reason, proposed_by)
    values (v_target.id, v_target.rank_id, v_rank.id, p_reason, v_actor)
    returning id into v_req;
    return jsonb_build_object('result', 'proposed', 'request_id', v_req, 'rank', v_rank.name);
  else
    select name into v_cap from public.ranks where leader_can_approve order by sort_order desc limit 1;
    raise exception 'You can''t make that rank change. Directors and Chairs can promote members of their own division or initiative up to %; higher ranks and all demotions need an Admin, and nobody can change their own rank', coalesce(v_cap, '(no rank)')
      using errcode = '42501';
  end if;
end $$;

-- Pending promotion proposals, oldest first.
create function public.bot_pending_promotions() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at), '[]'::jsonb)
  from (
    select p.id, m.discord_id, m.discord_name, fr.name as from_rank, tr.name as to_rank,
           p.reason, pb.discord_name as proposed_by, p.created_at
    from public.promotion_requests p
    join public.members m on m.id = p.member_id
    left join public.ranks fr on fr.id = p.from_rank
    join public.ranks tr on tr.id = p.to_rank
    left join public.members pb on pb.id = p.proposed_by
    where p.status = 'pending'
  ) x
$$;

-- /promote decide: an Admin approves or rejects a proposal.
create function public.bot_decide_promotion(p_actor_discord text, p_request_id uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.bot_set_actor(p_actor_discord);
  v_req   public.promotion_requests;
begin
  if not public.member_is_admin(v_actor) then
    raise exception 'Only an Admin can decide promotions' using errcode = '42501';
  end if;

  select * into v_req from public.promotion_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'That promotion request isn''t pending any more';
  end if;
  if v_req.member_id = v_actor then
    raise exception 'You can''t decide your own promotion' using errcode = '42501';
  end if;

  if p_approve then
    perform set_config('cortana.change_reason', v_req.reason, true);
    update public.members set rank_id = v_req.to_rank where id = v_req.member_id;
  end if;

  update public.promotion_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.promotion_status,
         decided_by = v_actor,
         decided_at = now()
   where id = v_req.id;

  return jsonb_build_object(
    'result', case when p_approve then 'approved' else 'rejected' end,
    'discord_id', (select discord_id from public.members where id = v_req.member_id),
    'rank', (select name from public.ranks where id = v_req.to_rank)
  );
end $$;

-- /setup roles: what each managed role should be called, and the ID stored so far.
create function public.bot_role_targets() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(t order by t ->> 'label'), '[]'::jsonb)
  from (
    select jsonb_build_object('kind', 'initiative', 'id', i.id, 'slug', null,
             'label', 'Initiative: ' || i.name, 'expected_name', i.discord_role_name, 'role_id', i.discord_role_id) as t
    from public.initiatives i
    union all
    select jsonb_build_object('kind', 'division', 'id', d.id, 'slug', null,
             'label', 'Division: ' || i.name || ' / ' || d.name, 'expected_name', d.discord_role_name, 'role_id', d.discord_role_id)
    from public.divisions d join public.initiatives i on i.id = d.initiative_id
    union all
    select jsonb_build_object('kind', 'unit', 'id', u.id, 'slug', null,
             'label', 'Unit: ' || i.name || ' / ' || d.name || ' / ' || u.name, 'expected_name', u.discord_role_name, 'role_id', u.discord_role_id)
    from public.units u join public.divisions d on d.id = u.division_id join public.initiatives i on i.id = d.initiative_id
    union all
    select jsonb_build_object('kind', 'rank', 'id', r.id, 'slug', i.slug,
             'label', 'Rank: ' || r.name || ' (' || i.name || ')',
             'expected_name', case when r.discord_role_name_pattern is null then null else
               replace(replace(replace(r.discord_role_name_pattern,
                 '{prefix}', coalesce(i.rank_role_prefix, '')), '{rank}', r.name), '{initiative}', i.name) end,
             'role_id', r.discord_role_ids ->> i.slug)
    from public.ranks r cross join public.initiatives i
    where i.is_home
    union all
    select jsonb_build_object('kind', 'member_role', 'id', null, 'slug', null,
             'label', 'Active member role', 'expected_name', s.member_role_name, 'role_id', s.member_role_id)
    from public.org_settings s
  ) x
$$;

-- /setup roles and /setup link: store Discord role IDs. Admin only.
-- p_links: [{"kind": "initiative|division|unit|rank|member_role", "id": uuid, "slug": initiative slug (ranks), "role_id": "..."}]
create function public.bot_set_role_ids(p_actor_discord text, p_links jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.bot_set_actor(p_actor_discord);
  v_link  jsonb;
  v_count int := 0;
begin
  if not public.member_is_admin(v_actor) then
    raise exception 'Only an Admin can link Discord roles' using errcode = '42501';
  end if;

  for v_link in select value from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    case v_link ->> 'kind'
      when 'initiative' then
        update public.initiatives set discord_role_id = v_link ->> 'role_id' where id = (v_link ->> 'id')::uuid;
      when 'division' then
        update public.divisions set discord_role_id = v_link ->> 'role_id' where id = (v_link ->> 'id')::uuid;
      when 'unit' then
        update public.units set discord_role_id = v_link ->> 'role_id' where id = (v_link ->> 'id')::uuid;
      when 'rank' then
        update public.ranks
           set discord_role_ids = discord_role_ids || jsonb_build_object(v_link ->> 'slug', v_link ->> 'role_id')
         where id = (v_link ->> 'id')::uuid
           and exists (select 1 from public.initiatives where slug = v_link ->> 'slug' and is_home);
      when 'member_role' then
        update public.org_settings set member_role_id = v_link ->> 'role_id', updated_at = now();
      else
        raise exception 'Unknown role link kind %', v_link ->> 'kind';
    end case;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;

-- Role sync: what this Discord user should have, and every role Cortana manages.
create function public.bot_role_state(p_discord_id text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when m.id is null then jsonb_build_object('in_cortana', false)
    else jsonb_build_object(
      'in_cortana', true,
      'desired', to_jsonb(public.member_desired_role_ids(m.id)),
      'managed', to_jsonb(public.managed_role_ids())
    )
  end
  from (select 1) one
  left join public.members m on m.discord_id = p_discord_id
$$;

-- /profile. Members (and applicants looking at themselves) only.
create function public.bot_profile(p_actor_discord text, p_target_discord text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_actor  uuid := public.bot_member_id(p_actor_discord);
  v_target public.members;
  v_ok     boolean;
begin
  select * into v_target from public.members where discord_id = p_target_discord;
  if not found then
    return null;
  end if;

  v_ok := v_actor = v_target.id
       or public.member_is_admin(v_actor)
       or exists (select 1 from public.members where id = v_actor and status = 'active' and rsi_verified_at is not null);
  if not coalesce(v_ok, false) then
    raise exception 'Only verified active members can view other members'' profiles' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'discord_id', v_target.discord_id,
    'discord_name', v_target.discord_name,
    'status', v_target.status,
    'rsi_handle', v_target.rsi_handle,
    'verified', v_target.rsi_verified_at is not null,
    'joined_at', v_target.joined_at,
    'timezone', v_target.timezone,
    'rank', (select name from public.ranks where id = v_target.rank_id),
    'assignments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'primary', a.is_primary, 'initiative', i.name, 'division', d.name, 'unit', u.name)
             order by a.is_primary desc, i.sort_order, d.sort_order), '[]'::jsonb)
      from public.member_assignments a
      join public.initiatives i on i.id = a.initiative_id
      left join public.divisions d on d.id = a.division_id
      left join public.units u on u.id = a.unit_id
      where a.member_id = v_target.id
    ),
    'appointments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'title', ap.title,
               'scope', case ap.scope when 'org' then 'Organisation'
                                       when 'initiative' then (select name from public.initiatives where id = ap.scope_id)
                                       else (select name from public.divisions where id = ap.scope_id) end,
               'review_on', ap.review_on)
             order by ap.starts_on), '[]'::jsonb)
      from public.appointments ap
      where ap.member_id = v_target.id
        and ap.starts_on <= current_date and (ap.ends_on is null or ap.ends_on > current_date)
    ),
    'awards', (
      select coalesce(jsonb_agg(jsonb_build_object('name', aw.name, 'awarded_on', ma.awarded_on) order by ma.awarded_on), '[]'::jsonb)
      from public.member_awards ma join public.awards aw on aw.id = ma.award_id
      where ma.member_id = v_target.id
    )
  );
end $$;

-- /roster. Verified active members and Admins only.
create function public.bot_roster(p_actor_discord text, p_initiative_slug text, p_division_slug text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.bot_member_id(p_actor_discord);
begin
  if not (
    public.member_is_admin(v_actor)
    or exists (select 1 from public.members where id = v_actor and status = 'active' and rsi_verified_at is not null)
  ) then
    raise exception 'Only verified active members can see the roster' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rank_order desc nulls last, lower(x.discord_name)), '[]'::jsonb)
    from (
      select m.discord_id, m.discord_name, r.name as rank, r.sort_order as rank_order,
             (select i.name from public.member_assignments a join public.initiatives i on i.id = a.initiative_id
               where a.member_id = m.id and a.is_primary) as home
      from public.members m
      left join public.ranks r on r.id = m.rank_id
      where m.status = 'active'
        and (
          p_initiative_slug is null
          or exists (
            select 1 from public.member_assignments a
            join public.initiatives i on i.id = a.initiative_id
            left join public.divisions d on d.id = a.division_id
            where a.member_id = m.id
              and i.slug = p_initiative_slug
              and (p_division_slug is null or d.slug = p_division_slug)
          )
        )
    ) x
  );
end $$;

-- ---------------------------------------------------------------------------
-- 6. Only the bot (service role) may call the bot_* functions and the per-member checks.
-- ---------------------------------------------------------------------------
revoke all on function public.member_is_admin(uuid)                              from public, anon, authenticated;
revoke all on function public.member_is_officer(uuid)                            from public, anon, authenticated;
revoke all on function public.member_is_director(uuid)                           from public, anon, authenticated;
revoke all on function public.member_can_direct(uuid, uuid, uuid)                from public, anon, authenticated;
revoke all on function public.member_promotion_right(uuid, uuid, uuid)           from public, anon, authenticated;
revoke all on function public.member_desired_role_ids(uuid)                      from public, anon, authenticated;
revoke all on function public.managed_role_ids()                                 from public, anon, authenticated;
revoke all on function public.bot_member_id(text)                                from public, anon, authenticated;
revoke all on function public.bot_set_actor(text)                                from public, anon, authenticated;
revoke all on function public.bot_whoami(text)                                   from public, anon, authenticated;
revoke all on function public.bot_enlist(text, text, text, text, text)           from public, anon, authenticated;
revoke all on function public.bot_start_verification(text, text, text)           from public, anon, authenticated;
revoke all on function public.bot_pending_verification(text)                     from public, anon, authenticated;
revoke all on function public.bot_complete_verification(text, uuid)              from public, anon, authenticated;
revoke all on function public.bot_manual_verify(text, text, text)                from public, anon, authenticated;
revoke all on function public.bot_assign(text, text, text, text, text, boolean)  from public, anon, authenticated;
revoke all on function public.bot_promote(text, text, text, text)                from public, anon, authenticated;
revoke all on function public.bot_pending_promotions()                           from public, anon, authenticated;
revoke all on function public.bot_decide_promotion(text, uuid, boolean)          from public, anon, authenticated;
revoke all on function public.bot_role_targets()                                 from public, anon, authenticated;
revoke all on function public.bot_set_role_ids(text, jsonb)                      from public, anon, authenticated;
revoke all on function public.bot_role_state(text)                               from public, anon, authenticated;
revoke all on function public.bot_profile(text, text)                            from public, anon, authenticated;
revoke all on function public.bot_roster(text, text, text)                       from public, anon, authenticated;

grant execute on function
  public.member_is_admin(uuid),
  public.member_is_officer(uuid),
  public.member_is_director(uuid),
  public.member_can_direct(uuid, uuid, uuid),
  public.member_promotion_right(uuid, uuid, uuid),
  public.member_desired_role_ids(uuid),
  public.managed_role_ids(),
  public.bot_member_id(text),
  public.bot_set_actor(text),
  public.bot_whoami(text),
  public.bot_enlist(text, text, text, text, text),
  public.bot_start_verification(text, text, text),
  public.bot_pending_verification(text),
  public.bot_complete_verification(text, uuid),
  public.bot_manual_verify(text, text, text),
  public.bot_assign(text, text, text, text, text, boolean),
  public.bot_promote(text, text, text, text),
  public.bot_pending_promotions(),
  public.bot_decide_promotion(text, uuid, boolean),
  public.bot_role_targets(),
  public.bot_set_role_ids(text, jsonb),
  public.bot_role_state(text),
  public.bot_profile(text, text),
  public.bot_roster(text, text, text)
to service_role;
