-- Cortana Phase 1: rank-change rules, rank_history and audit_log.
--
-- "Every change to rank, appointment, membership or award also writes a row to audit_log."
-- "Approve rank changes" is Admin-only (Directors propose; the propose step arrives in Phase 2).

-- ---------------------------------------------------------------------------
-- Column guard on members.
-- RLS lets a member update their own row (to edit their profile). This trigger stops them
-- changing anything except their profile fields. It runs as the CALLER (no SECURITY DEFINER),
-- so current_user tells us whether the request came through the public API.
-- ---------------------------------------------------------------------------
create function public.guard_member_changes() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- The bot (service_role), migrations and the dashboard are trusted; so are Admins.
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  if new.rank_id is distinct from old.rank_id then
    raise exception 'Only an Admin can change a member''s rank'
      using errcode = '42501';  -- insufficient_privilege
  end if;

  if new.status          is distinct from old.status
  or new.rsi_verified_at is distinct from old.rsi_verified_at
  or new.discord_id      is distinct from old.discord_id
  or new.discord_name    is distinct from old.discord_name
  or new.auth_user_id    is distinct from old.auth_user_id
  or new.joined_at       is distinct from old.joined_at then
    raise exception 'You can only change your own RSI handle and timezone'
      using errcode = '42501';
  end if;

  -- A new RSI handle has to be verified again.
  if new.rsi_handle is distinct from old.rsi_handle then
    new.rsi_verified_at := null;
  end if;

  return new;
end $$;

create trigger members_guard
  before update on public.members
  for each row execute function public.guard_member_changes();

-- ---------------------------------------------------------------------------
-- rank_history: one row for every promotion or demotion, however it happened.
-- ---------------------------------------------------------------------------
create function public.log_rank_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.rank_history (member_id, from_rank, to_rank, reason, approved_by)
  values (
    new.id,
    old.rank_id,
    new.rank_id,
    nullif(current_setting('cortana.change_reason', true), ''),
    public.current_member_id()
  );
  return null;
end $$;

create trigger members_rank_history
  after update of rank_id on public.members
  for each row
  when (old.rank_id is distinct from new.rank_id)
  execute function public.log_rank_change();

-- ---------------------------------------------------------------------------
-- change_rank(): the one supported way for apps to change a rank, with a reason.
-- Runs as the caller, so RLS and the guard above still apply.
--   supabase.rpc('change_rank', { p_member_id, p_rank_id, p_reason })
-- ---------------------------------------------------------------------------
create function public.change_rank(p_member_id uuid, p_rank_id uuid, p_reason text) returns void
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() then
    raise exception 'Only an Admin can change a member''s rank'
      using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required for a rank change';
  end if;

  perform set_config('cortana.change_reason', p_reason, true);

  update public.members set rank_id = p_rank_id where id = p_member_id;
  if not found then
    raise exception 'Member % not found', p_member_id;
  end if;

  perform set_config('cortana.change_reason', '', true);
end $$;

grant execute on function public.change_rank(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- audit_log: before/after snapshot of every sensitive change.
-- ---------------------------------------------------------------------------
create function public.audit_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before jsonb;
  v_after  jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after  := to_jsonb(new); end if;

  if tg_op = 'UPDATE' and v_before = v_after then
    return null;  -- nothing actually changed
  end if;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, before, after)
  values (
    public.current_member_id(),
    -- current_user is this function's owner (SECURITY DEFINER); the 'role' setting is the caller's.
    nullif(current_setting('role', true), 'none'),
    lower(tg_op),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id')::uuid,
    v_before,
    v_after
  );
  return null;
end $$;

create trigger members_audit
  after insert or update or delete on public.members
  for each row execute function public.audit_change();

create trigger member_assignments_audit
  after insert or update or delete on public.member_assignments
  for each row execute function public.audit_change();

create trigger appointments_audit
  after insert or update or delete on public.appointments
  for each row execute function public.audit_change();

create trigger member_awards_audit
  after insert or update or delete on public.member_awards
  for each row execute function public.audit_change();

create trigger ranks_audit
  after insert or update or delete on public.ranks
  for each row execute function public.audit_change();
