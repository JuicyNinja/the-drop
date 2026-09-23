-- Bulk duplicate: atomic all-or-nothing allowance consume.
--
-- Bulk-duplicating a drop to N dates schedules N copies, each consuming one
-- drop from the org's cycle allowance. Allowance is never restored (invariant
-- #2), so a partial consume cannot be rolled back — the batch must consume all
-- N or none. app_consume_drop_allowance_n is the atomic primitive: it adds N in
-- a single statement, but only if the whole batch fits under the limit, and
-- returns -1 (consuming nothing) otherwise. Mirrors app_consume_drop_allowance
-- (WP-5) with a batch size.

create or replace function app_consume_drop_allowance_n(
  p_org          uuid,
  p_location     uuid,        -- null = pooled at org level
  p_cycle_start  timestamptz,
  p_cycle_end    timestamptz,
  p_limit        integer,
  p_n            integer
) returns integer
language plpgsql as $$
declare v_used integer;
begin
  -- Nothing to do / would never fit: reject, consume nothing.
  if p_limit < 1 or p_n < 1 or p_n > p_limit then
    return -1;
  end if;

  insert into drop_allowance_usage (org_id, location_id, cycle_start, cycle_end, drops_used)
  values (p_org, p_location, p_cycle_start, p_cycle_end, p_n)   -- p_n <= p_limit guaranteed above
  on conflict (org_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), cycle_start)
  do update set drops_used = drop_allowance_usage.drops_used + p_n
    where drop_allowance_usage.drops_used + p_n <= p_limit   -- all-or-nothing: the whole batch must fit
  returning drops_used into v_used;

  -- Null means the conflict row existed and adding the whole batch would exceed
  -- the limit — no row was written, so nothing was consumed.
  if v_used is null then
    return -1;
  end if;
  return v_used;
end $$;

revoke all on function app_consume_drop_allowance_n(uuid, uuid, timestamptz, timestamptz, integer, integer) from public;
grant execute on function app_consume_drop_allowance_n(uuid, uuid, timestamptz, timestamptz, integer, integer) to service_role;
