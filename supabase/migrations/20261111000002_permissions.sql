-- Cortana Phase 1: row-level security matching docs/SPEC.md, "Permission levels".
--
--   Member   any verified active member: see the roster, sign up for ops, edit own profile and hangar
--   Officer  rank tier 'officer' or above: create ops, take attendance, write after-action reports
--   Director rank tier 'director'/'chair' AND an active appointment: assign members inside that
--            initiative/division only
--   Admin    an active appointment with scope 'org' (the owner and =The High Table=):
--            approve rank changes, appointments and awards; edit org structure
--
-- The website and the bot log in as the 'authenticated' role, so these rules apply to anyone
-- calling the API directly. The bot's service-role key bypasses RLS; that is why it must stay secret.

-- ---------------------------------------------------------------------------
-- Who is asking? (SECURITY DEFINER so they can read members without tripping RLS recursively)
-- ---------------------------------------------------------------------------
create function public.current_member_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.members where auth_user_id = auth.uid()
$$;

create function public.is_active_member() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.members m
    where m.auth_user_id = auth.uid()
      and m.status = 'active'
      and m.rsi_verified_at is not null
  )
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.members m
    join public.appointments a on a.member_id = m.id
    where m.auth_user_id = auth.uid()
      and m.status = 'active'
      and a.scope = 'org'
      and a.starts_on <= current_date
      and (a.ends_on is null or a.ends_on > current_date)
  )
$$;

create function public.is_officer() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin() or exists (
    select 1
    from public.members m
    join public.ranks r on r.id = m.rank_id
    where m.auth_user_id = auth.uid()
      and m.status = 'active'
      and r.tier in ('officer', 'director', 'chair')
  )
$$;

-- A Director-rank member with at least one current initiative/division appointment.
create function public.is_director() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.members m
    join public.ranks r on r.id = m.rank_id
    join public.appointments a on a.member_id = m.id
    where m.auth_user_id = auth.uid()
      and m.status = 'active'
      and r.tier in ('director', 'chair')
      and a.scope in ('initiative', 'division')
      and a.starts_on <= current_date
      and (a.ends_on is null or a.ends_on > current_date)
  )
$$;

-- Can the caller, as a Director, act on this initiative / division?
-- An initiative appointment covers the whole initiative; a division appointment covers that
-- division and its sub-divisions. "The Chair of Eos has no oversight of Helios or Selene."
create function public.can_direct(p_initiative_id uuid, p_division_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.members m
    join public.ranks r on r.id = m.rank_id
    join public.appointments a on a.member_id = m.id
    where m.auth_user_id = auth.uid()
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

-- ---------------------------------------------------------------------------
-- Table privileges (RLS below then narrows them row by row).
-- Supabase grants most of these by default; stating them keeps the migration self-contained.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

alter table public.ranks              enable row level security;
alter table public.initiatives        enable row level security;
alter table public.divisions          enable row level security;
alter table public.units              enable row level security;
alter table public.awards             enable row level security;
alter table public.ships              enable row level security;
alter table public.members            enable row level security;
alter table public.member_assignments enable row level security;
alter table public.appointments       enable row level security;
alter table public.member_awards      enable row level security;
alter table public.operations         enable row level security;
alter table public.op_signups         enable row level security;
alter table public.member_ships       enable row level security;
alter table public.rank_history       enable row level security;
alter table public.audit_log          enable row level security;

-- ---------------------------------------------------------------------------
-- Org structure and catalogues: public read (the website shows them), Admin write.
-- ---------------------------------------------------------------------------
create policy "Anyone can read ranks"       on public.ranks       for select to anon, authenticated using (true);
create policy "Admins manage ranks"         on public.ranks       for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read initiatives" on public.initiatives for select to anon, authenticated using (true);
create policy "Admins manage initiatives"   on public.initiatives for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read divisions"   on public.divisions   for select to anon, authenticated using (true);
create policy "Admins manage divisions"     on public.divisions   for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read units"       on public.units       for select to anon, authenticated using (true);
create policy "Admins manage units"         on public.units       for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read awards"      on public.awards      for select to anon, authenticated using (true);
create policy "Admins manage awards"        on public.awards      for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read ships"       on public.ships       for select to anon, authenticated using (true);
create policy "Admins manage ships"         on public.ships       for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- members
-- Which COLUMNS a member may change on their own row (not rank, status...) is enforced by the
-- members_guard trigger in the next migration, because RLS works on rows, not columns.
-- ---------------------------------------------------------------------------
create policy "Read own member record" on public.members
  for select to authenticated using (auth_user_id = auth.uid());

create policy "Members read the active roster" on public.members
  for select to authenticated using (public.is_active_member() and status = 'active');

create policy "Directors and admins read all members" on public.members
  for select to authenticated using (public.is_director() or public.is_admin());

create policy "Start own application" on public.members
  for insert to authenticated
  with check (
    auth_user_id = auth.uid()
    and status = 'applicant'
    and rank_id is null
    and rsi_verified_at is null
  );

create policy "Edit own profile" on public.members
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy "Admins manage members" on public.members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- member_assignments: Directors inside their scope, Admins anywhere.
-- ---------------------------------------------------------------------------
create policy "Members read assignments" on public.member_assignments
  for select to authenticated
  using (public.is_active_member() or public.is_admin() or member_id = public.current_member_id());

create policy "Directors and admins manage assignments in scope" on public.member_assignments
  for all to authenticated
  using (public.is_admin() or public.can_direct(initiative_id, division_id))
  with check (public.is_admin() or public.can_direct(initiative_id, division_id));

-- ---------------------------------------------------------------------------
-- appointments and member_awards: Admin approves.
-- ---------------------------------------------------------------------------
create policy "Members read appointments" on public.appointments
  for select to authenticated
  using (public.is_active_member() or public.is_admin() or member_id = public.current_member_id());

create policy "Admins manage appointments" on public.appointments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Members read awards given" on public.member_awards
  for select to authenticated
  using (public.is_active_member() or public.is_admin() or member_id = public.current_member_id());

create policy "Admins manage awards given" on public.member_awards
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- operations and op_signups: Officers run ops, Members sign themselves up.
-- ---------------------------------------------------------------------------
create policy "Members read operations" on public.operations
  for select to authenticated using (public.is_active_member() or public.is_officer());

create policy "Anyone reads public completed operations" on public.operations
  for select to anon, authenticated using (is_public and status = 'completed');

create policy "Officers create operations" on public.operations
  for insert to authenticated with check (public.is_officer());

create policy "Officers update operations" on public.operations
  for update to authenticated using (public.is_officer()) with check (public.is_officer());

create policy "Admins delete operations" on public.operations
  for delete to authenticated using (public.is_admin());

create policy "Members read sign-ups" on public.op_signups
  for select to authenticated using (public.is_active_member() or public.is_officer());

-- Members sign themselves up but cannot mark themselves 'attended'; Officers take attendance.
create policy "Members sign up, officers take attendance" on public.op_signups
  for insert to authenticated
  with check (
    (member_id = public.current_member_id() and public.is_active_member() and status <> 'attended')
    or public.is_officer()
  );

create policy "Members change own sign-up, officers any" on public.op_signups
  for update to authenticated
  using (member_id = public.current_member_id() or public.is_officer())
  with check (
    (member_id = public.current_member_id() and status <> 'attended')
    or public.is_officer()
  );

create policy "Members withdraw own sign-up, officers any" on public.op_signups
  for delete to authenticated
  using (member_id = public.current_member_id() or public.is_officer());

-- ---------------------------------------------------------------------------
-- member_ships: the hangar is private by default.
-- ---------------------------------------------------------------------------
create policy "Read own hangar; officers see ships offered for ops" on public.member_ships
  for select to authenticated
  using (
    member_id = public.current_member_id()
    or public.is_admin()
    or (available_for_ops and public.is_officer())
  );

create policy "Edit own hangar" on public.member_ships
  for all to authenticated
  using (member_id = public.current_member_id() or public.is_admin())
  with check (member_id = public.current_member_id() or public.is_admin());

-- ---------------------------------------------------------------------------
-- rank_history and audit_log: written only by triggers (next migration), never directly.
-- No insert/update/delete policies = nobody using the API can write or alter them.
-- ---------------------------------------------------------------------------
create policy "Read own rank history; admins read all" on public.rank_history
  for select to authenticated using (member_id = public.current_member_id() or public.is_admin());

create policy "Admins read the audit log" on public.audit_log
  for select to authenticated using (public.is_admin());
