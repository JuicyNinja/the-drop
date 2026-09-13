-- WP-4 addresses: geocode provenance for auditability and cache semantics.
-- Coordinates already live on the address row (lat/lng); these columns record
-- that a geocode happened, what it resolved to, and how precise it was. The
-- coordinate is never re-fetched for an unchanged address — only on create or
-- on an edit that changes a line of the address itself.

set search_path = public, extensions;

alter table addresses
  add column geocoded_at        timestamptz,
  add column formatted_address  text,
  add column geo_location_type  text;   -- provider precision, e.g. ROOFTOP

-- ---------------------------------------------------------------------------
-- Local discovery seam. The Local board (WP-11) is built on this: live local
-- drops whose location is within the ACTIVE address's radius. This is the one
-- place the active address drives results — discovery, never redemption
-- (invariant #10). Distance uses earthdistance (meters); radius is per-address.
-- ---------------------------------------------------------------------------
create or replace function app_discover_local_drops(p_user_id uuid)
returns table (id uuid, title text, location_id uuid, distance_miles numeric)
language sql stable as $$
  select d.id, d.title, d.location_id,
         (earth_distance(
            ll_to_earth(a.lat::float8, a.lng::float8),
            ll_to_earth(l.lat::float8, l.lng::float8)
          ) / 1609.344)::numeric as distance_miles
  from users u
  join addresses a on a.id = u.active_address_id
  join drops d on d.lane = 'local' and d.status = 'live'
  join locations l on l.id = d.location_id
  where u.id = p_user_id
    and a.lat is not null and a.lng is not null
    and earth_distance(
          ll_to_earth(a.lat::float8, a.lng::float8),
          ll_to_earth(l.lat::float8, l.lng::float8)
        ) <= a.radius_miles * 1609.344
  order by distance_miles asc;
$$;

revoke all on function app_discover_local_drops(uuid) from public;
grant execute on function app_discover_local_drops(uuid) to service_role;
