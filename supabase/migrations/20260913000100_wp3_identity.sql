-- WP-3 identity additions: handle normalization, first-session walkthrough.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Confusable-collapsed handle form. Uniqueness is enforced on this, not on
-- the raw handle, so t_a_d / tad / t0d cannot coexist. Order is load-bearing
-- and MUST match lib/handles.ts normalizeHandle(): multi-char maps first
-- (rn→m, vv→w), then single-char homoglyphs (0→o, 1→l, 5→s), then strip
-- underscores. A test pins the two implementations together.
-- ---------------------------------------------------------------------------
create or replace function normalize_handle(h text) returns text
language sql immutable parallel safe as $$
  select replace(
           translate(
             replace(replace(lower(h), 'rn', 'm'), 'vv', 'w'),
             '015', 'ols'
           ),
           '_', ''
         );
$$;

alter table users
  add column handle_normalized text
    generated always as (normalize_handle(handle::text)) stored;

create unique index users_handle_normalized_key on users (handle_normalized);

-- First-session tooltip walkthrough. Nullable timestamp, per account, so a
-- second device does not replay it and completion time is a funnel metric.
-- Set by either .../walkthrough/complete or .../walkthrough/skip.
alter table users
  add column walkthrough_completed_at timestamptz;

-- Reserved handles are compared on the same normalized form as live handles.
create index reserved_handles_normalized on reserved_handles (normalize_handle(handle::text));

-- ---------------------------------------------------------------------------
-- Atomic registration completion: the users row, the Home address, the active
-- address pointer, and the implicit buyer role in one transaction. Format
-- validation and the reserved-name check happen in the route before this runs;
-- the handle_normalized unique index is the backstop against a race.
-- ---------------------------------------------------------------------------
create or replace function app_complete_registration(
  p_user_id   uuid,
  p_handle    text,
  p_full_name text,
  p_email     text,
  p_phone     text,
  p_label     text,
  p_line1     text,
  p_line2     text,
  p_city      text,
  p_region    text,
  p_postal    text,
  p_country   text
) returns users
language plpgsql as $$
declare
  v_addr_id uuid;
  v_user    users;
begin
  insert into users (id, handle, full_name, email, phone)
    values (p_user_id, p_handle, p_full_name, p_email, p_phone);

  insert into addresses (user_id, label, line1, line2, city, region, postal_code, country, is_home)
    values (p_user_id, p_label, p_line1, nullif(p_line2, ''), p_city, p_region, p_postal, coalesce(nullif(p_country, ''), 'US'), true)
    returning id into v_addr_id;

  update users set active_address_id = v_addr_id, updated_at = now()
    where id = p_user_id
    returning * into v_user;

  insert into user_roles (user_id, role) values (p_user_id, 'buyer')
    on conflict do nothing;

  return v_user;
end $$;

revoke all on function app_complete_registration(uuid, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function app_complete_registration(uuid, text, text, text, text, text, text, text, text, text, text, text) to service_role;
