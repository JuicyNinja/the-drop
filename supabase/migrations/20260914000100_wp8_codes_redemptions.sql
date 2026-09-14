-- WP-8 + WP-7 correction.
--
-- PRD §7.3 is doctrine: ONE code per drop (printed on a sheet, read aloud by
-- staff, typed by the buyer). WP-7 minted a random code per catch, which the
-- redemption mechanic cannot use. The code now lives on the drop, generated at
-- go-live (not at create — a code must not sit on a scheduled drop for days
-- before it opens). catches.code becomes a denormalized copy for response
-- convenience (see the DATA-MODEL §8.1 note).

set search_path = public, extensions;

alter table drops add column code text;   -- one code per drop, set at go-live

-- No two CONCURRENTLY-LIVE drops at the same location may share a code, or
-- staff reading from two sheets is ambiguous and a buyer could redeem the
-- wrong drop. Enforced by a partial unique index over live drops per location;
-- the go-live job regenerates on the (astronomically rare) collision.
create unique index drops_live_code_per_location
  on drops (location_id, code)
  where status = 'live' and code is not null;

-- Velocity flag (PRD §7.6): same account redeeming at locations physically too
-- distant in too little time. Advisory only — surfaced in admin fraud review,
-- never blocks a redemption.
alter table redemptions add column velocity_flagged boolean not null default false;
