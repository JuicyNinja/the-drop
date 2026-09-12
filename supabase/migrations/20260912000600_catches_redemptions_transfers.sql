-- WP-2 / DATA-MODEL §8 the catch, §8.3 redemptions, §9 transfers.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- §8.1 catches. Append-only. Position numbers permanent and never reused.
-- ---------------------------------------------------------------------------
create table catches (
  id                uuid primary key default gen_random_uuid(),
  drop_id           uuid not null references drops(id),
  user_id           uuid not null references users(id),   -- CURRENT holder
  original_user_id  uuid not null references users(id),   -- first catcher, immutable
  position_number   integer not null,
  status            catch_status not null default 'held',
  code              text not null,                        -- 4-char, 24-symbol alphabet
  transfer_count    smallint not null default 0,
  caught_at         timestamptz not null default now(),
  expires_at        timestamptz not null,                 -- = drop.redeem_until

  -- Keyed on the ORIGINAL catcher: catch → transfer away → catch again is blocked.
  constraint one_catch_per_buyer_per_drop
    unique (drop_id, original_user_id),
  -- Collision impossible at the database level. Gaps are correct.
  constraint position_unique_per_drop
    unique (drop_id, position_number),
  constraint max_one_hop
    check (transfer_count <= 1)
);

create index on catches (user_id, status);
create index on catches (drop_id, position_number);
create index on catches (expires_at) where status in ('held', 'transfer_pending');

-- No delete, ever. Expiry is a status change.
create trigger trg_catches_no_delete before delete on catches
  for each row execute function forbid_row_delete();

-- The permanent parts of a catch never change: which drop, who caught it
-- first, which position, and when. Transfers move user_id only.
create or replace function enforce_catch_permanence() returns trigger
language plpgsql as $$
begin
  if new.drop_id          is distinct from old.drop_id
  or new.original_user_id is distinct from old.original_user_id
  or new.position_number  is distinct from old.position_number
  or new.caught_at        is distinct from old.caught_at then
    raise exception 'Catch drop, original catcher, position number, and caught_at are permanent'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger trg_catch_permanence before update on catches
  for each row execute function enforce_catch_permanence();

-- ---------------------------------------------------------------------------
-- §8.3 redemptions. One per catch, enforced by the unique on catch_id.
-- ---------------------------------------------------------------------------
create table redemptions (
  id              uuid primary key default gen_random_uuid(),
  catch_id        uuid not null unique references catches(id),
  drop_id         uuid not null references drops(id),
  location_id     uuid not null references locations(id),
  user_id         uuid not null references users(id),   -- who actually redeemed
  method          redemption_method not null,
  lat             numeric(9,6),
  lng             numeric(9,6),
  accuracy_m      numeric(8,2),
  distance_m      numeric(10,2),
  redeemed_at     timestamptz not null default now()
);

create index on redemptions (location_id, redeemed_at desc);
create index on redemptions (user_id, redeemed_at desc);
create index on redemptions (method) where method = 'unverified_timeout';

create trigger trg_redemptions_no_delete before delete on redemptions
  for each row execute function forbid_row_delete();

-- ---------------------------------------------------------------------------
-- §9 transfers. One hop, 5-minute accept window, 30-minute pre-close cutoff.
-- Window and cutoff are enforced at write time by the API and the sweeper;
-- the hop limit lives on catches.transfer_count.
-- ---------------------------------------------------------------------------
create table transfers (
  id              uuid primary key default gen_random_uuid(),
  catch_id        uuid not null references catches(id),
  from_user_id    uuid not null references users(id),
  to_user_id      uuid not null references users(id),
  status          transfer_status not null default 'pending',
  sent_at         timestamptz not null default now(),
  accept_by       timestamptz not null,              -- sent_at + 5 minutes
  resolved_at     timestamptz,
  constraint no_self_transfer check (from_user_id <> to_user_id)
);

create index on transfers (catch_id);
create index on transfers (to_user_id, status);
create index on transfers (accept_by) where status = 'pending';
