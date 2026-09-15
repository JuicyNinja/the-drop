-- WP-12 fix: the daily digest must land at the user's LOCAL morning hour, not a
-- UTC hour. `digest_hour_local` is named local but was compared against UTC, so a
-- Salt Lake buyer choosing 8am would be paged at 1-2am. Resolve it against an
-- IANA timezone (DST-correct), defaulted from the user's city.

set search_path = public, extensions;

-- Each city carries an IANA timezone. The launch market (Utah) is Mountain;
-- WP-14's city-launch action sets the correct zone per city as markets open.
alter table cities add column timezone text not null default 'America/Denver';
update cities set timezone = 'America/Denver' where region = 'UT';

-- A user's IANA timezone, defaulted at registration from their Home city. The
-- digest resolves each user's local hour against it. Nullable: when absent, the
-- digest falls back to the active address's city timezone — never UTC.
alter table users add column timezone text;
