-- Recurring redemption windows + merchant logo branding.

-- A. Drops: an optional recurring daily window. redeem_from / redeem_until stay
--    the OUTER date range (and the final close / catch expiry). These three add a
--    daily window interpreted in the location's city timezone. redeem_days uses
--    JS day-of-week (0=Sun … 6=Sat). Null redeem_days = one continuous window, so
--    existing drops are unchanged.
alter table drops
  add column redeem_days       smallint[],
  add column redeem_time_start time,
  add column redeem_time_end   time;

-- The daily window is valid (end after start) and its three fields travel together.
alter table drops add constraint redeem_daily_valid
  check (redeem_time_end is null or redeem_time_start is null or redeem_time_end > redeem_time_start);
alter table drops add constraint redeem_daily_complete
  check ((redeem_days is null and redeem_time_start is null and redeem_time_end is null)
      or (redeem_days is not null and redeem_time_start is not null and redeem_time_end is not null));

-- Invariant #3: the daily-window fields join the frozen set once a drop is live.
-- Whole body re-declared (migrations are append-only) with the three new columns.
create or replace function enforce_live_immutability() returns trigger
language plpgsql as $$
begin
  if old.status in ('live', 'gone', 'expired') then
    if new.quantity_total    is distinct from old.quantity_total
    or new.price_cents       is distinct from old.price_cents
    or new.terms             is distinct from old.terms
    or new.redeem_from       is distinct from old.redeem_from
    or new.redeem_until      is distinct from old.redeem_until
    or new.redeem_days       is distinct from old.redeem_days
    or new.redeem_time_start is distinct from old.redeem_time_start
    or new.redeem_time_end   is distinct from old.redeem_time_end
    or new.title             is distinct from old.title
    or new.description       is distinct from old.description then
      raise exception 'Drop is immutable once live. Create an Encore instead.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

-- B. Merchant logo mark: a '/path' (demo tiles) or a 'data:' URI (operator upload;
--    no storage infrastructure exists). Null → the UI renders a monogram fallback.
alter table organizations add column logo_url text;
