-- WP-2 / DATA-MODEL §10 follows, §11 clout/badges/whispers, §12 ranking, §13 notifications.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- §10 follows. Fanatic cap: 10 per lane, independent pools.
-- ---------------------------------------------------------------------------
create table follows (
  user_id     uuid not null references users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  lane        lane not null,                    -- denormalized from org for cap enforcement
  tier        follow_tier not null default 'follower',
  created_at  timestamptz not null default now(),
  primary key (user_id, org_id)
);

create index on follows (org_id, tier);
create unique index fanatic_slots on follows (user_id, lane, org_id) where tier = 'fanatic';

create or replace function enforce_fanatic_cap() returns trigger
language plpgsql as $$
declare n integer;
begin
  if new.tier = 'fanatic' then
    select count(*) into n from follows
      where user_id = new.user_id and lane = new.lane and tier = 'fanatic'
        and org_id <> new.org_id;
    if n >= 10 then
      raise exception 'Fanatic limit reached for this lane (10). Free a slot first.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger trg_fanatic_cap before insert or update on follows
  for each row execute function enforce_fanatic_cap();

-- ---------------------------------------------------------------------------
-- §11.1 clout_events. Append-only ledger. Three sources, no grant path.
-- Append-only is enforced three ways so no role can get around it:
--   1. triggers reject UPDATE and DELETE for every role, owner included;
--   2. UPDATE/DELETE privileges are revoked from every API role (RLS migration);
--   3. no RLS policy grants UPDATE or DELETE.
-- ---------------------------------------------------------------------------
create table clout_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  source        clout_source not null,
  points        integer not null check (points > 0),
  city_id       uuid references cities(id),
  ref_type      text,                            -- 'redemption' | 'whisper' | 'share'
  ref_id        uuid,
  occurred_at   timestamptz not null default now()
);

create index on clout_events (user_id, occurred_at desc);
create index on clout_events (city_id, occurred_at desc);

create trigger trg_clout_events_no_update before update on clout_events
  for each row execute function forbid_row_update();
create trigger trg_clout_events_no_delete before delete on clout_events
  for each row execute function forbid_row_delete();

-- ---------------------------------------------------------------------------
-- §11.2 clout_scores. Materialized, recomputed hourly.
-- ---------------------------------------------------------------------------
create table clout_scores (
  user_id       uuid not null references users(id) on delete cascade,
  city_id       uuid not null references cities(id),
  raw_score     numeric(12,4) not null,
  decayed_score numeric(12,4) not null,
  percentile    numeric(6,4) not null,
  tier          smallint not null check (tier between 1 and 5),
  computed_at   timestamptz not null default now(),
  primary key (user_id, city_id)
);

-- ---------------------------------------------------------------------------
-- §11.3 share_links. Tracked links only in v1.
-- ---------------------------------------------------------------------------
create table share_links (
  id            uuid primary key default gen_random_uuid(),
  token         text unique not null,
  user_id       uuid not null references users(id),
  drop_id       uuid not null references drops(id),
  redemption_id uuid references redemptions(id),   -- non-null = share of a redemption act
  click_count   integer not null default 0,
  verified_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- §11.4 badges / user_badges. Separate from clout: no decay, no cap.
-- Seeded empty: the badge list is an open product decision (2026-09-12).
-- ---------------------------------------------------------------------------
create table badges (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  label       text not null,
  description text not null
);

create table user_badges (
  user_id   uuid not null references users(id) on delete cascade,
  badge_id  uuid not null references badges(id),
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- §11.5 whispers. Read-only for merchants. Never public.
-- ---------------------------------------------------------------------------
create table whispers (
  id              uuid primary key default gen_random_uuid(),
  redemption_id   uuid not null unique references redemptions(id),
  user_id         uuid not null references users(id),
  org_id          uuid not null references organizations(id),
  location_id     uuid not null references locations(id),
  would_return_at_full_price boolean not null,   -- the anchor dimension
  dim_2           smallint not null check (dim_2 between 1 and 5),
  dim_3           smallint not null check (dim_3 between 1 and 5),
  dim_4           smallint not null check (dim_4 between 1 and 5),
  note            text,
  created_at      timestamptz not null default now()
);

create index on whispers (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- §11.6 merchant_scores. Not a ranking input.
-- ---------------------------------------------------------------------------
create table merchant_scores (
  org_id            uuid primary key references organizations(id) on delete cascade,
  redemption_rate   numeric(5,4) not null,      -- redemptions / catches, trailing window
  whisper_score     numeric(5,4),
  drops_counted     integer not null,
  computed_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- §12 drop_pressure. pct_remaining ascending is THE ranking metric.
-- ---------------------------------------------------------------------------
create table drop_pressure (
  drop_id           uuid primary key references drops(id) on delete cascade,
  views             integer not null default 0,
  catches           integer not null default 0,
  pct_remaining     numeric(5,4) not null,       -- THE ranking metric
  computed_at       timestamptz not null default now()
);

create index on drop_pressure (pct_remaining asc);

-- ---------------------------------------------------------------------------
-- §13 notifications. No quiet hours table exists. There are no quiet hours.
-- ---------------------------------------------------------------------------
create table notification_prefs (
  user_id           uuid primary key references users(id) on delete cascade,
  push_enabled      boolean not null default true,
  email_enabled     boolean not null default true,
  sms_enabled       boolean not null default true,
  digest_hour_local smallint not null default 8
);

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  kind          text not null,
  channel       text not null,            -- 'push' | 'sms' | 'email' | 'in_app'
  payload       jsonb not null,
  sent_at       timestamptz,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index on notifications (user_id, created_at desc);
create index on notifications (sent_at) where sent_at is null;

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  endpoint    text not null,
  keys        jsonb not null,
  created_at  timestamptz not null default now()
);
