-- WP-2 base seed. Idempotent: safe to re-run against a database that already
-- carries it. The taxonomy seed (taxonomy-seed.sql) loads after this file.
--
-- Contents:
--   * cities: Salt Lake City and Provo, both inactive and unlaunched. WP-14's
--     admin city-launch action is what flips a market live.
--   * founder: user_number 1, Tad Timothy, handle tad, admin role. Email and
--     phone unverified, location permission not granted: the founder account
--     is subject to every gate like any other account.
--   * reserved handle: tad, reason system.
--   * badges: none. The badge list is an open product decision (2026-09-12).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Cities
-- ---------------------------------------------------------------------------
insert into cities (name, region, country, lat, lng, active, launched_at,
                    default_geofence_m, coldstart_days, coldstart_min_events)
select 'Salt Lake City', 'UT', 'US', 40.7608, -111.8910, false, null, 150, 30, 500
where not exists (select 1 from cities where name = 'Salt Lake City' and region = 'UT');

insert into cities (name, region, country, lat, lng, active, launched_at,
                    default_geofence_m, coldstart_days, coldstart_min_events)
select 'Provo', 'UT', 'US', 40.2338, -111.6585, false, null, 150, 30, 500
where not exists (select 1 from cities where name = 'Provo' and region = 'UT');

-- ---------------------------------------------------------------------------
-- Reserved handles
-- ---------------------------------------------------------------------------
insert into reserved_handles (handle, reason) values ('tad', 'system')
on conflict (handle) do nothing;

-- ---------------------------------------------------------------------------
-- Founder. Guarded on email and user_number, never on handle.
-- ---------------------------------------------------------------------------
do $$
declare
  founder_id    constant uuid := '00000000-0000-4000-8000-000000000001';
  founder_email constant text := 'info@juicyninja.com';
begin
  if exists (select 1 from users where email = founder_email) then
    raise notice 'founder already seeded; skipping';
  elsif exists (select 1 from users where user_number = 1) then
    raise warning 'user_number 1 is already taken by another account; founder NOT seeded';
  else
    -- Auth row first: users.id references auth.users(id). No password; the
    -- founder signs in through OAuth (WP-3). email_confirmed_at stays null.
    insert into auth.users (
      id, instance_id, aud, role, email,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      founder_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', founder_email,
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now()
    )
    on conflict (id) do nothing;

    insert into users (id, user_number, handle, full_name, email, phone)
    values (founder_id, 1, 'tad', 'Tad Timothy', founder_email, '+10000000001');

    insert into user_roles (user_id, role, granted_by)
    values (founder_id, 'admin', founder_id);
  end if;

  -- The sequence continues after the highest number in use, so the next
  -- signup gets 2 and re-running this seed never consumes a value.
  perform setval('user_number_seq', greatest(coalesce((select max(user_number) from users), 0), 1));
end $$;
