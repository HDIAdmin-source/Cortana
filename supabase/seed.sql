-- Cortana seed data: org structure from docs/SPEC.md
--   "Org model Cortana will store" and "Live Discord server versus the confirmed structure".
--
-- Safe to run more than once (existing rows are left alone).
-- Deliberately NOT seeded:
--   * members other than the confirmed leaders at the bottom of this file
--   * awards (deferred by the owner)
--   * Discord role IDs (Phase 2's /setup roles matches them by discord_role_name)
--   * a separate Salvage division (owner: Salvage is part of Eos Industry)

-- ---------------------------------------------------------------------------
-- Rank ladder, lowest to highest
-- ---------------------------------------------------------------------------
-- leader_can_approve: owner decision 11 Nov 2026, division leaders approve promotions up to Prefect.
-- discord_role_name_pattern: how the live Discord role is named per home initiative
--   ({prefix} = H-/E-/S-, {rank} = rank name, {initiative} = initiative name).
insert into public.ranks (name, tier, sort_order, leader_can_approve, discord_role_name_pattern, description) values
  ('Hoplite',    'member',   1, true,  '{prefix}{rank}',        'Entry stage; onboarding and proving reliability'),
  ('Operator',   'member',   2, true,  '{prefix}{rank}',        'Qualified participating member'),
  ('Specialist', 'member',   3, true,  '{prefix}{rank}',        'Deeper competence in a defined field'),
  -- Prefect is Officer "for their own team, to confirm" in the spec; kept at member level until confirmed.
  ('Prefect',    'member',   4, true,  '{prefix}{rank}',        'Small-team supervision and standards'),
  ('Praetor',    'officer',  5, false, '{prefix}{rank}',        'Senior member with broader leadership duties'),
  ('Centurion',  'officer',  6, false, '{prefix}{rank}',        'Most senior non-director rank'),
  -- Live server: one "Division Director" role. (Sub Division Director and EOS Initiative
  -- Sub-Director are left to be handed out by hand for now.)
  ('Director',   'director', 7, false, 'Division Director',     'Held by members appointed to run a division (Sub-Division Director, Division Director, or an initiative Sub-Director)'),
  ('Chair',      'chair',    8, false, 'Chair of {initiative}', 'Highest rank, one per home initiative (Chair of Helios, Eos, Selene)')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Organisation settings: RSI org tag for /verify, and the active-member Discord role
-- (owner decisions 11 Nov 2026: the org page is OLDHUNTERS; active members get "HDI").
-- ---------------------------------------------------------------------------
insert into public.org_settings (id, rsi_org_sid, member_role_name)
values (true, 'OLDHUNTERS', 'HDI')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Initiatives (Greek mottos exactly as written in the spec)
-- ---------------------------------------------------------------------------
insert into public.initiatives
  (slug, name, motto_greek, motto_en, remit, emoji_id, discord_role_name, rank_role_prefix, is_home, sort_order)
values
  ('helios', 'Helios',
   'Φύλακες τοῦ Στόλου, κυρίαρχοι τοῦ Ὁρίζοντα',
   'Guardians of the Fleet, Masters of the Horizon',
   'Fleets, personnel and orbital assets; exploration and medical support',
   '1429599840190337106', 'Helios Initiative', 'H-', true, 1),

  ('eos', 'Eos',
   'Χτίζουμε τὸ μέλλον, στηρίζουμε τὴν ἀποστολή',
   'We build the future, We fund the mission',
   'Commerce, industry and innovation; self-sufficiency and profit',
   '1429599815683280926', 'Eos Initiative', 'E-', true, 2),

  ('selene', 'Selene',
   'Στο πεδίο, εἴμαστε ἀπόλυτοι',
   'On the ground, we are absolute',
   'Planetside power: infantry, armour, atmospheric support',
   '1429599863460466738', 'Selene Initiative', 'S-', true, 3),

  -- Auxiliary: open to members of any home initiative; no rank ladder, no Chair.
  -- No Auxiliary initiative role exists on the live server yet (open question).
  ('auxiliary', 'Auxiliary',
   'Ἐν σιωπῇ, ἡ ἰσχύς μιλεῖ.',
   'In silence, strength speaks',
   'Specialist roles any member can join, supporting every initiative',
   null, null, null, false, 4)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Divisions. discord_role_name is the role's name on the live server
-- (note the live spellings "Archeology" and "Armored Legion").
-- ---------------------------------------------------------------------------
insert into public.divisions (initiative_id, slug, name, description, discord_role_name, sort_order)
select i.id, d.slug, d.name, d.description, d.discord_role_name, d.sort_order
from (values
  ('helios',    'fleet',            'Fleet',            'Wings are its squadrons',          'Helios - Fleet Division',           1),
  ('helios',    'medical',          'Medical',          'Medical support; N.O.V.A. and H.E.R.D. report here', 'Helios - Medical Division', 2),

  ('eos',       'commerce',         'Commerce',         null,                               'Eos - Commerce Division',           1),
  ('eos',       'industry',         'Industry',         'Mining and salvage',               'Eos - Industry Division',           2),
  ('eos',       'manufacturing',    'Manufacturing',    null,                               'Eos - Manufacturing Division',      3),
  ('eos',       'archaeology',      'Archaeology',      null,                               'Eos - Archeology Division',         4),

  ('selene',    'legion',           'Legion',           'Infantry',                         'Selene - Legion Division',          1),
  ('selene',    'armoured',         'Armoured',         'Armour',                           'Selene - Armored Legion Division',  2),

  ('auxiliary', 'engineering',      'Engineering',      null,                               'Auxiliary - Engineering Division',  1),
  ('auxiliary', 'pathfinder',       'Pathfinder',       'Intelligence',                     'Auxiliary - Pathfinder Division',   2),
  ('auxiliary', 'legion-venatorum', 'Legion Venatorum', null,                               'Auxiliary - Venatorum Division',    3),
  -- No Media Division role on the live server yet (a "Media Officer" role exists).
  ('auxiliary', 'media',            'Media',            null,                               null,                                4)
) as d(initiative_slug, slug, name, description, discord_role_name, sort_order)
join public.initiatives i on i.slug = d.initiative_slug
on conflict (initiative_id, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Units: Fleet squadrons (wings) and the medical units.
-- Squadron role names are "<Name> Sq" as listed in the spec; /setup roles will ask an
-- admin to confirm any it cannot match exactly.
-- ---------------------------------------------------------------------------
insert into public.units (division_id, name, kind, discord_role_name, sort_order)
select dv.id, u.name, u.kind::public.unit_kind, u.discord_role_name, u.sort_order
from (values
  ('helios', 'fleet',   'Chatter',  'squadron', 'Chatter Sq',  1),
  ('helios', 'fleet',   'Reaper',   'squadron', 'Reaper Sq',   2),
  ('helios', 'fleet',   'Scar',     'squadron', 'Scar Sq',     3),
  ('helios', 'fleet',   'Viper',    'squadron', 'Viper Sq',    4),
  ('helios', 'fleet',   'Dagger',   'squadron', 'Dagger Sq',   5),
  ('helios', 'fleet',   'Mobile',   'squadron', 'Mobile Sq',   6),
  ('helios', 'fleet',   'Puncture', 'squadron', 'Puncture Sq', 7),
  ('helios', 'fleet',   'Dragon',   'squadron', 'Dragon Sq',   8),
  ('helios', 'medical', 'N.O.V.A.', 'medical',  'N.O.V.A.',    1),
  ('helios', 'medical', 'H.E.R.D.', 'medical',  'H.E.R.D.',    2)
) as u(initiative_slug, division_slug, name, kind, discord_role_name, sort_order)
join public.initiatives i on i.slug = u.initiative_slug
join public.divisions dv on dv.initiative_id = i.id and dv.slug = u.division_slug
on conflict (division_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- Confirmed leaders (owner answers, 11 November 2026; docs/SPEC.md).
-- discord_name is a starting label; the bot refreshes it from Discord.
-- They are 'active' but not RSI-verified until they run /verify.
-- ---------------------------------------------------------------------------
insert into public.members (discord_id, discord_name, status, rank_id)
select l.discord_id, l.discord_name, 'active', r.id
from (values
  ('358101352938995715', 'Hary',   'Chair'),
  ('143127736414633984', 'Chance', 'Chair'),
  ('242246773555462145', 'Tusk',   'Chair'),
  -- Org Chairman: Admin, with no rank and no home initiative (owner decision).
  ('201532643483975681', 'Wolffe', null)
) as l(discord_id, discord_name, rank_name)
left join public.ranks r on r.name = l.rank_name
on conflict (discord_id) do nothing;

-- Home initiatives for the three Chairs.
insert into public.member_assignments (member_id, initiative_id, is_primary)
select m.id, i.id, true
from (values
  ('358101352938995715', 'helios'),
  ('143127736414633984', 'eos'),
  ('242246773555462145', 'selene')
) as a(discord_id, initiative_slug)
join public.members m on m.discord_id = a.discord_id
join public.initiatives i on i.slug = a.initiative_slug
on conflict (member_id) where is_primary do nothing;

-- Appointments: each Chair over their own initiative, and all four as Admins
-- (an org-wide appointment is what makes someone an Admin).
insert into public.appointments (member_id, title, scope, scope_id)
select m.id, x.title, x.scope::public.appointment_scope, i.id
from (values
  ('358101352938995715', 'Chair of Helios',  'initiative', 'helios'),
  ('143127736414633984', 'Chair of Eos',     'initiative', 'eos'),
  ('242246773555462145', 'Chair of Selene',  'initiative', 'selene'),
  ('201532643483975681', 'Org Chairman',     'org',        null),
  ('358101352938995715', '=The High Table=', 'org',        null),
  ('143127736414633984', '=The High Table=', 'org',        null),
  ('242246773555462145', '=The High Table=', 'org',        null)
) as x(discord_id, title, scope, initiative_slug)
join public.members m on m.discord_id = x.discord_id
left join public.initiatives i on i.slug = x.initiative_slug
where not exists (
  select 1 from public.appointments a where a.member_id = m.id and a.title = x.title
);
