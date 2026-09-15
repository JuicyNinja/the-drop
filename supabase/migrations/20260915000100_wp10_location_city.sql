-- WP-10: a location must ALWAYS resolve to a city.
--
-- A city-less location silently drops every clout event that happens there —
-- there is no leaderboard for the event to join, and no error is raised. In
-- production that is a merchant whose redemptions earn buyers nothing and a
-- buyer watching clout not move, with no explanation available to anyone.
-- Resolution now happens at create/edit time (lib/orgs.ts → lib/cities.ts); this
-- migration closes the schema hole so the invariant cannot be bypassed.

set search_path = public, extensions;

-- Backfill any existing null-city location to its NEAREST city. This is dev-data
-- hygiene: a fresh production database has no such rows. earthdistance over
-- ll_to_earth gives great-circle metres.
update locations l
set city_id = (
  select c.id from cities c
  order by earth_distance(ll_to_earth(l.lat, l.lng), ll_to_earth(c.lat, c.lng)) asc
  limit 1
)
where l.city_id is null and l.lat is not null and l.lng is not null;

alter table locations alter column city_id set not null;
