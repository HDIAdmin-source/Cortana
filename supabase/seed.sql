-- Cortana seed data: org structure from docs/SPEC.md
--   "Org model Cortana will store" and "Live Discord server versus the confirmed structure".
--
-- Safe to run more than once (existing rows are left alone).
-- Deliberately NOT seeded until the open questions are answered:
--   * members and leaders (are the recorded leaders current and safe to seed?)
--   * awards (which award roles are official?)
--   * Discord role IDs (Phase 2's /setup roles matches them by discord_role_name)
--   * a separate Salvage sub-division (Salvage is part of Eos Industry for now)

-- ---------------------------------------------------------------------------
-- Rank ladder, lowest to highest
-- ---------------------------------------------------------------------------
insert into public.ranks (name, tier, sort_order, description) values
  ('Hoplite',    'member',   1, 'Entry stage; onboarding and proving reliability'),
  ('Operator',   'member',   2, 'Qualified participating member'),
  ('Specialist', 'member',   3, 'Deeper competence in a defined field'),
  -- Prefect is Officer "for their own team, to confirm" in the spec; kept at member level until confirmed.
  ('Prefect',    'member',   4, 'Small-team supervision and standards'),
  ('Praetor',    'officer',  5, 'Senior member with broader leadership duties'),
  ('Centurion',  'officer',  6, 'Most senior non-director rank'),
  ('Director',   'director', 7, 'Held by members appointed to run a division (Sub-Division Director, Division Director, or an initiative Sub-Director)'),
  ('Chair',      'chair',    8, 'Highest rank, one per home initiative (Chair of Helios, Eos, Selene)')
on conflict (name) do nothing;

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
