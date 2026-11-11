-- Cortana Phase 3: operations, sign-ups, attendance, after-action reports and hangars
-- (docs/SPEC.md, "Discord bot, version 1" and the Phase 3 roadmap prompt).
--
-- As in Phase 2, the bot changes data only through bot_* functions that check the person
-- who ran the command: Officers (Praetor and above) and Admins run operations; verified active
-- members sign up and keep their own hangar, which is private unless a ship is offered for ops.

-- ---------------------------------------------------------------------------
-- 1. Data
-- ---------------------------------------------------------------------------
alter table public.operations
  add column discord_channel_id text,   -- where the op's sign-up post lives
  add column discord_message_id text,
  add column created_by uuid references public.members (id) on delete set null;

-- Extra ship facts from the Star Citizen Wiki API.
alter table public.ships
  add column wiki_slug text,            -- for linking to api.star-citizen.wiki/vehicles/<slug>
  add column size text,                 -- e.g. Small, Medium, Capital
  add column career text,               -- e.g. Combat, Transporter
  add column kind text check (kind is null or kind in ('spaceship', 'ground'));
create index ships_name_idx on public.ships (lower(name));

create trigger operations_audit after insert or update or delete on public.operations for each row execute function public.audit_change();
create trigger op_signups_audit after insert or update or delete on public.op_signups for each row execute function public.audit_change();

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create function public.member_is_verified_active(p_member uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.members
    where id = p_member and status = 'active' and rsi_verified_at is not null
  )
$$;

create function public.require_officer(p_actor uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.member_is_officer(p_actor) then
    raise exception 'Only Officers (Praetor and above) and Admins can run operations' using errcode = '42501';
  end if;
end $$;

create function public.require_member(p_member uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.member_is_verified_active(p_member) then
    raise exception 'Only verified active members can do that. New here? Use /enlist and /verify first' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Operations
-- ---------------------------------------------------------------------------

-- /op create
create function public.bot_op_create(
  p_actor_discord text, p_name text, p_starts_at timestamptz, p_objective text,
  p_initiative_slug text, p_staging text, p_comms_channel text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.bot_set_actor(p_actor_discord);
  v_init  uuid;
  v_id    uuid;
begin
  perform public.require_officer(v_actor);
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'The operation needs a name';
  end if;
  if p_starts_at is null or p_starts_at < now() then
    raise exception 'That start time is in the past. Times are entered in UTC';
  end if;
  if p_initiative_slug is not null then
    select id into v_init from public.initiatives where slug = p_initiative_slug;
    if v_init is null then
      raise exception 'Unknown initiative';
    end if;
  end if;

  insert into public.operations (name, objective, lead_initiative_id, commander_id, starts_at, staging, comms_channel, created_by)
  values (btrim(p_name), nullif(btrim(p_objective), ''), v_init, v_actor, p_starts_at,
          nullif(btrim(p_staging), ''), nullif(btrim(p_comms_channel), ''), v_actor)
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end $$;

-- Remember where the sign-up post is, so it can be updated later.
create function public.bot_op_set_message(p_op_id uuid, p_channel_id text, p_message_id text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.operations set discord_channel_id = p_channel_id, discord_message_id = p_message_id where id = p_op_id
$$;

-- Everything needed to draw an op's post.
create function public.bot_op_summary(p_op_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'objective', o.objective,
    'starts_at', o.starts_at,
    'staging', o.staging,
    'comms_channel', o.comms_channel,
    'status', o.status,
    'after_action', o.after_action,
    'is_public', o.is_public,
    'initiative', i.name,
    'commander_discord_id', c.discord_id,
    'channel_id', o.discord_channel_id,
    'message_id', o.discord_message_id,
    'signups', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'discord_id', m.discord_id, 'name', m.discord_name, 'status', s.status,
               'role', s.role, 'ship', sh.name)
             order by s.status, lower(m.discord_name)), '[]'::jsonb)
      from public.op_signups s
      join public.members m on m.id = s.member_id
      left join public.ships sh on sh.id = s.ship_id
      where s.operation_id = o.id
    )
  )
  from public.operations o
  left join public.initiatives i on i.id = o.lead_initiative_id
  left join public.members c on c.id = o.commander_id
  where o.id = p_op_id
$$;

-- Sign-up buttons: going / maybe / declined.
create function public.bot_op_signup(p_discord_id text, p_op_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member uuid := public.bot_set_actor(p_discord_id);
  v_op     public.operations;
  v_prev   public.signup_status;
begin
  perform public.require_member(v_member);
  if p_status not in ('going', 'maybe', 'declined') then
    raise exception 'Unknown sign-up choice';
  end if;

  select * into v_op from public.operations where id = p_op_id;
  if not found then
    raise exception 'That operation no longer exists';
  end if;
  if v_op.status not in ('planned', 'live') then
    raise exception 'Sign-ups for this operation are closed';
  end if;

  select status into v_prev from public.op_signups where operation_id = p_op_id and member_id = v_member;
  if v_prev = 'attended' then
    raise exception 'You''ve already been marked as attended for this operation';
  end if;

  insert into public.op_signups (operation_id, member_id, status)
  values (p_op_id, v_member, p_status::public.signup_status)
  on conflict (operation_id, member_id) do update set status = excluded.status;

  return jsonb_build_object('status', p_status);
end $$;

-- Pick which of your hangar ships you're bringing (or none).
create function public.bot_op_set_ship(p_discord_id text, p_op_id uuid, p_member_ship_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member uuid := public.bot_set_actor(p_discord_id);
  v_ship   uuid;
begin
  perform public.require_member(v_member);
  if p_member_ship_id is not null then
    select ship_id into v_ship from public.member_ships where id = p_member_ship_id and member_id = v_member;
    if v_ship is null then
      raise exception 'That ship isn''t in your hangar';
    end if;
  end if;

  update public.op_signups set ship_id = v_ship
   where operation_id = p_op_id and member_id = v_member and status in ('going', 'maybe');
  if not found then
    raise exception 'Sign up as Going or Maybe first';
  end if;

  return jsonb_build_object('ship', (select name from public.ships where id = v_ship));
end $$;

-- Say what you'll do on the op (pilot, medic, gunner...).
create function public.bot_op_set_role(p_discord_id text, p_op_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member uuid := public.bot_set_actor(p_discord_id);
begin
  perform public.require_member(v_member);
  update public.op_signups set role = nullif(left(btrim(coalesce(p_role, '')), 60), '')
   where operation_id = p_op_id and member_id = v_member and status in ('going', 'maybe');
  if not found then
    raise exception 'Sign up as Going or Maybe first';
  end if;
  return jsonb_build_object('role', nullif(left(btrim(coalesce(p_role, '')), 60), ''));
end $$;

-- /op attend: mark people as attended (or un-mark them). Walk-ins who didn't sign up count too.
create function public.bot_op_attend(p_actor_discord text, p_op_id uuid, p_discord_ids text[], p_attended boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor   uuid := public.bot_set_actor(p_actor_discord);
  v_status  public.operation_status;
  v_count   int;
  v_unknown text[];
begin
  perform public.require_officer(v_actor);
  select status into v_status from public.operations where id = p_op_id;
  if v_status is null then
    raise exception 'That operation no longer exists';
  end if;
  if v_status = 'cancelled' then
    raise exception 'That operation was cancelled';
  end if;

  v_unknown := array(
    select x from unnest(coalesce(p_discord_ids, '{}')) x
    where not exists (select 1 from public.members m where m.discord_id = x and m.status = 'active')
  );

  if p_attended then
    insert into public.op_signups (operation_id, member_id, status)
    select p_op_id, m.id, 'attended'
    from public.members m
    where m.discord_id = any(coalesce(p_discord_ids, '{}')) and m.status = 'active'
    on conflict (operation_id, member_id) do update set status = 'attended';
  else
    update public.op_signups s set status = 'going'
      from public.members m
     where s.member_id = m.id and s.operation_id = p_op_id and s.status = 'attended'
       and m.discord_id = any(coalesce(p_discord_ids, '{}'));
  end if;
  get diagnostics v_count = row_count;

  if p_attended and v_status = 'planned' then
    update public.operations set status = 'live' where id = p_op_id;
  end if;

  return jsonb_build_object(
    'changed', v_count,
    'unknown', to_jsonb(v_unknown),
    'attended_total', (select count(*) from public.op_signups where operation_id = p_op_id and status = 'attended')
  );
end $$;

-- /op aar: record the after-action summary and close the op.
create function public.bot_op_aar(p_actor_discord text, p_op_id uuid, p_summary text, p_public boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.bot_set_actor(p_actor_discord);
begin
  perform public.require_officer(v_actor);
  if btrim(coalesce(p_summary, '')) = '' then
    raise exception 'The after-action report can''t be empty';
  end if;
  update public.operations
     set after_action = btrim(p_summary), status = 'completed', is_public = coalesce(p_public, false)
   where id = p_op_id and status <> 'cancelled';
  if not found then
    raise exception 'That operation doesn''t exist or was cancelled';
  end if;
  return jsonb_build_object(
    'attended', (select count(*) from public.op_signups where operation_id = p_op_id and status = 'attended')
  );
end $$;

-- /op cancel
create function public.bot_op_cancel(p_actor_discord text, p_op_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.bot_set_actor(p_actor_discord);
begin
  perform public.require_officer(v_actor);
  update public.operations set status = 'cancelled' where id = p_op_id and status in ('planned', 'live');
  if not found then
    raise exception 'Only planned or live operations can be cancelled';
  end if;
end $$;

-- Ops to offer in /op menus: open ones, plus those from the last two weeks.
create function public.bot_ops_recent() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.starts_at desc), '[]'::jsonb)
  from (
    select id, name, starts_at, status from public.operations
    where status in ('planned', 'live') or starts_at > now() - interval '14 days'
    order by starts_at desc
    limit 25
  ) x
$$;

-- ---------------------------------------------------------------------------
-- 4. Hangars (self-reported, private by default)
-- ---------------------------------------------------------------------------
create function public.bot_hangar_add(p_discord_id text, p_ship_id uuid, p_available boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member uuid := public.bot_set_actor(p_discord_id);
  v_name   text;
begin
  perform public.require_member(v_member);
  select name into v_name from public.ships where id = p_ship_id;
  if v_name is null then
    raise exception 'Pick a ship from the list';
  end if;
  insert into public.member_ships (member_id, ship_id, source, available_for_ops)
  values (v_member, p_ship_id, 'typed', coalesce(p_available, false));
  return jsonb_build_object('ship', v_name, 'available_for_ops', coalesce(p_available, false));
end $$;

create function public.bot_hangar_update(p_discord_id text, p_member_ship_id uuid, p_available boolean, p_remove boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member uuid := public.bot_set_actor(p_discord_id);
  v_name   text;
begin
  perform public.require_member(v_member);
  select s.name into v_name from public.member_ships ms join public.ships s on s.id = ms.ship_id
   where ms.id = p_member_ship_id and ms.member_id = v_member;
  if v_name is null then
    raise exception 'That ship isn''t in your hangar';
  end if;
  if coalesce(p_remove, false) then
    update public.op_signups set ship_id = null
     where member_id = v_member
       and ship_id = (select ship_id from public.member_ships where id = p_member_ship_id)
       and operation_id in (select id from public.operations where status in ('planned', 'live'));
    delete from public.member_ships where id = p_member_ship_id;
    return jsonb_build_object('ship', v_name, 'removed', true);
  end if;
  update public.member_ships set available_for_ops = coalesce(p_available, false) where id = p_member_ship_id;
  return jsonb_build_object('ship', v_name, 'available_for_ops', coalesce(p_available, false));
end $$;

-- Your own hangar in full; Officers see only ships members have offered for ops; Admins see all.
create function public.bot_hangar_list(p_actor_discord text, p_target_discord text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_actor  uuid := public.bot_member_id(p_actor_discord);
  v_target uuid := public.bot_member_id(p_target_discord);
  v_only_available boolean;
begin
  if v_target is null then
    raise exception 'That person isn''t in Cortana';
  end if;
  if v_actor = v_target or public.member_is_admin(v_actor) then
    v_only_available := false;
  elsif public.member_is_officer(v_actor) then
    v_only_available := true;
  else
    raise exception 'Hangars are private. Officers can see ships members have offered for ops' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', ms.id, 'ship', s.name, 'manufacturer', s.manufacturer, 'role', s.role,
             'size', s.size, 'available_for_ops', ms.available_for_ops)
           order by lower(s.name)), '[]'::jsonb)
    from public.member_ships ms join public.ships s on s.id = ms.ship_id
    where ms.member_id = v_target and (not v_only_available or ms.available_for_ops)
  );
end $$;

-- ---------------------------------------------------------------------------
-- 5. Only the bot (service role) may call these.
-- ---------------------------------------------------------------------------
revoke all on function public.member_is_verified_active(uuid)                                    from public, anon, authenticated;
revoke all on function public.require_officer(uuid)                                              from public, anon, authenticated;
revoke all on function public.require_member(uuid)                                               from public, anon, authenticated;
revoke all on function public.bot_op_create(text, text, timestamptz, text, text, text, text)     from public, anon, authenticated;
revoke all on function public.bot_op_set_message(uuid, text, text)                               from public, anon, authenticated;
revoke all on function public.bot_op_summary(uuid)                                               from public, anon, authenticated;
revoke all on function public.bot_op_signup(text, uuid, text)                                    from public, anon, authenticated;
revoke all on function public.bot_op_set_ship(text, uuid, uuid)                                  from public, anon, authenticated;
revoke all on function public.bot_op_set_role(text, uuid, text)                                  from public, anon, authenticated;
revoke all on function public.bot_op_attend(text, uuid, text[], boolean)                         from public, anon, authenticated;
revoke all on function public.bot_op_aar(text, uuid, text, boolean)                              from public, anon, authenticated;
revoke all on function public.bot_op_cancel(text, uuid)                                          from public, anon, authenticated;
revoke all on function public.bot_ops_recent()                                                   from public, anon, authenticated;
revoke all on function public.bot_hangar_add(text, uuid, boolean)                                from public, anon, authenticated;
revoke all on function public.bot_hangar_update(text, uuid, boolean, boolean)                    from public, anon, authenticated;
revoke all on function public.bot_hangar_list(text, text)                                        from public, anon, authenticated;

grant execute on function
  public.member_is_verified_active(uuid),
  public.require_officer(uuid),
  public.require_member(uuid),
  public.bot_op_create(text, text, timestamptz, text, text, text, text),
  public.bot_op_set_message(uuid, text, text),
  public.bot_op_summary(uuid),
  public.bot_op_signup(text, uuid, text),
  public.bot_op_set_ship(text, uuid, uuid),
  public.bot_op_set_role(text, uuid, text),
  public.bot_op_attend(text, uuid, text[], boolean),
  public.bot_op_aar(text, uuid, text, boolean),
  public.bot_op_cancel(text, uuid),
  public.bot_ops_recent(),
  public.bot_hangar_add(text, uuid, boolean),
  public.bot_hangar_update(text, uuid, boolean, boolean),
  public.bot_hangar_list(text, text)
to service_role;
