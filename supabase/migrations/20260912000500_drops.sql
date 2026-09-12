-- WP-2 / DATA-MODEL §7 drops: table, live immutability, counter monotonic,
-- state-transition guard, local-skips-approval.

set search_path = public, extensions;

create table drops (
  id                    uuid primary key default gen_random_uuid(),
  lane                  lane not null,
  org_id                uuid not null references organizations(id),
  location_id           uuid references locations(id),   -- required for lane='local'
  city_id               uuid references cities(id),

  status                drop_status not null default 'draft',

  title                 text not null,
  description           text not null,
  terms                 text,
  image_urls            text[],

  quantity_total        integer not null check (quantity_total > 0),
  quantity_remaining    integer not null,

  -- Maker / Digital only. Null for local.
  price_cents           integer check (price_cents >= 0),
  restocking_fee_bps    integer default 2000,            -- 20.00%, PRD §15.1.3

  live_at               timestamptz,
  live_until            timestamptz,
  redeem_from           timestamptz,
  redeem_until          timestamptz,

  parent_drop_id        uuid references drops(id),       -- Encore lineage
  duplicated_from_id    uuid references drops(id),       -- Duplicate lineage

  submitted_at          timestamptz,
  approved_at           timestamptz,
  approved_by           uuid references users(id),
  rejected_reason       text,
  gone_at               timestamptz,

  created_by            uuid not null references users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint local_requires_location
    check (lane <> 'local' or location_id is not null),
  constraint local_has_no_price
    check (lane <> 'local' or price_cents is null),
  constraint purchase_lanes_have_price
    check (lane = 'local' or price_cents is not null),
  constraint redeem_window_valid
    check (redeem_until is null or redeem_from is null or redeem_until > redeem_from),
  constraint remaining_never_negative
    check (quantity_remaining >= 0 and quantity_remaining <= quantity_total)
);

create index on drops (status, lane, live_at);
create index on drops (location_id) where status = 'live';
create index on drops (city_id, status);
create index on drops (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- §7.2 Immutability after live. DOCTRINE. CLAUDE.md invariant #3.
-- ---------------------------------------------------------------------------
create or replace function enforce_live_immutability() returns trigger
language plpgsql as $$
begin
  if old.status in ('live', 'gone', 'expired') then
    if new.quantity_total  is distinct from old.quantity_total
    or new.price_cents     is distinct from old.price_cents
    or new.terms           is distinct from old.terms
    or new.redeem_from     is distinct from old.redeem_from
    or new.redeem_until    is distinct from old.redeem_until
    or new.title           is distinct from old.title
    or new.description     is distinct from old.description then
      raise exception 'Drop is immutable once live. Create an Encore instead.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger trg_live_immutability before update on drops
  for each row execute function enforce_live_immutability();

-- quantity_remaining is the only mutable field after go-live, and it only
-- ever decreases. CLAUDE.md invariant #2.
create or replace function enforce_counter_never_rises() returns trigger
language plpgsql as $$
begin
  if old.status = 'live' and new.quantity_remaining > old.quantity_remaining then
    raise exception 'Counters never go up. Create an Encore.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger trg_counter_monotonic before update on drops
  for each row execute function enforce_counter_never_rises();

-- ---------------------------------------------------------------------------
-- §7.3 State transition guard.
--
--   draft        → submitted | scheduled     (scheduled direct: lane='local' only)
--   submitted    → approved | rejected
--   approved     → scheduled
--   scheduled    → live | draft
--   live         → gone | expired
--   gone         → encore_pending
--
-- Every drop begins as draft: an INSERT with any other status is rejected,
-- otherwise the machine could be entered mid-way. Local drops never enter
-- submitted or approved, on insert or update (PRD §4.2, auto-publish).
-- ---------------------------------------------------------------------------
create or replace function enforce_drop_transitions() returns trigger
language plpgsql as $$
begin
  if new.lane = 'local' and new.status in ('submitted', 'approved') then
    raise exception 'Local drops never enter %. Local auto-publishes and skips approval.', new.status
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'A drop is created as draft, not %', new.status
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'draft'     and new.status = 'submitted' and new.lane <> 'local')
    or (old.status = 'draft'     and new.status = 'scheduled' and new.lane = 'local')
    or (old.status = 'submitted' and new.status in ('approved', 'rejected'))
    or (old.status = 'approved'  and new.status = 'scheduled')
    or (old.status = 'scheduled' and new.status in ('live', 'draft'))
    or (old.status = 'live'      and new.status in ('gone', 'expired'))
    or (old.status = 'gone'      and new.status = 'encore_pending')
  ) then
    raise exception 'Invalid drop status transition: % → %', old.status, new.status
      using errcode = 'P0001';
  end if;

  return new;
end $$;

create trigger trg_drop_transitions before insert or update of status on drops
  for each row execute function enforce_drop_transitions();
