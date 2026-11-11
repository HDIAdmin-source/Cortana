-- Fix: /setup roles failed on real Supabase with "UPDATE requires a WHERE clause".
-- Supabase's API blocks UPDATE/DELETE statements without a WHERE (the pg-safeupdate
-- safety switch). The single-row org_settings update in bot_set_role_ids had none.
-- Same function as in 20261112000001_phase2_bot.sql, with "where id" added.
-- (CREATE OR REPLACE keeps the existing service-role-only permissions.)

create or replace function public.bot_set_role_ids(p_actor_discord text, p_links jsonb) returns int
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
        update public.org_settings set member_role_id = v_link ->> 'role_id', updated_at = now() where id;
      else
        raise exception 'Unknown role link kind %', v_link ->> 'kind';
    end case;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;
