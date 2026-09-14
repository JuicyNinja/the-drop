-- WP-5 organizations: atomic org creation (org + owner role) and atomic,
-- race-safe drop-allowance consumption. Limits live on the organizations row
-- and are NEVER derived from the tier enum at runtime; these functions take the
-- limit as a parameter that the caller reads from the stored column.

set search_path = public, extensions;

-- Create an org and grant its creator the owner role, atomically.
create or replace function app_create_org(
  p_owner            uuid,
  p_name             text,
  p_lane             lane,
  p_tier             subscription_tier,
  p_max_locations    integer,
  p_drops_per_cycle  integer,
  p_pooled           boolean
) returns organizations
language plpgsql as $$
declare v_org organizations;
begin
  insert into organizations (name, lane, tier, max_locations, drops_per_cycle, drops_pooled_org_level, cycle_anchor_at)
  values (p_name, p_lane, p_tier, p_max_locations, p_drops_per_cycle, p_pooled, now())
  returning * into v_org;

  insert into user_roles (user_id, role, org_id, granted_by)
  values (p_owner, 'merchant_owner', v_org.id, p_owner);

  return v_org;
end $$;

revoke all on function app_create_org(uuid, text, lane, subscription_tier, integer, integer, boolean) from public;
grant execute on function app_create_org(uuid, text, lane, subscription_tier, integer, integer, boolean) to service_role;

-- Consume one drop from an allowance scope, atomically and monotonically.
-- Scope is the org row (pooled: p_location null) or a location (per-location).
-- Returns the new drops_used, or -1 when the scope is already at its limit.
-- The counter is only ever incremented, never decremented (invariant #2): a
-- cancelled drop still consumed its allowance.
create or replace function app_consume_drop_allowance(
  p_org          uuid,
  p_location     uuid,        -- null = pooled at org level
  p_cycle_start  timestamptz,
  p_cycle_end    timestamptz,
  p_limit        integer
) returns integer
language plpgsql as $$
declare v_used integer;
begin
  if p_limit < 1 then
    return -1;
  end if;

  insert into drop_allowance_usage (org_id, location_id, cycle_start, cycle_end, drops_used)
  values (p_org, p_location, p_cycle_start, p_cycle_end, 1)
  on conflict (org_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), cycle_start)
  do update set drops_used = drop_allowance_usage.drops_used + 1
    where drop_allowance_usage.drops_used < p_limit
  returning drops_used into v_used;

  -- Null means the conflict row existed and the WHERE (under limit) failed.
  if v_used is null then
    return -1;
  end if;
  return v_used;
end $$;

revoke all on function app_consume_drop_allowance(uuid, uuid, timestamptz, timestamptz, integer) from public;
grant execute on function app_consume_drop_allowance(uuid, uuid, timestamptz, timestamptz, integer) to service_role;
