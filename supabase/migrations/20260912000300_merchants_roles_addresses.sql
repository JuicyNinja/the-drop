-- WP-2 / DATA-MODEL §4 merchants, §2.2 user_roles, §3 addresses.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- §4.1 organizations
-- ---------------------------------------------------------------------------
create table organizations (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  lane                  lane not null,              -- 'local' | 'maker' | 'digital'
  status                org_status not null default 'active',
  tier                  subscription_tier not null,

  -- Per-account limits. NEVER derive these from the tier enum at runtime.
  -- Enterprise requires arbitrary values.
  max_locations         integer not null,
  drops_per_cycle       integer not null,
  drops_pooled_org_level boolean not null default false,

  stripe_customer_id    text unique,
  stripe_subscription_id text unique,
  cycle_anchor_at       timestamptz not null,       -- 30-day anniversary, not calendar month
  intro_expires_at      timestamptz,                -- $9/3mo on annual

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- §4.2 locations
-- ---------------------------------------------------------------------------
create table locations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  name            text not null,
  line1           text not null,
  line2           text,
  city            text not null,
  region          text not null,
  postal_code     text not null,
  country         text not null default 'US',
  lat             numeric(9,6) not null,
  lng             numeric(9,6) not null,
  geofence_radius_m integer not null default 150,   -- PRD §7.4
  hours           jsonb,
  city_id         uuid references cities(id),
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create index on locations (org_id);
create index locations_geo on locations using gist (ll_to_earth(lat::float8, lng::float8));

-- ---------------------------------------------------------------------------
-- §4.3 drop_allowance_usage
-- ---------------------------------------------------------------------------
create table drop_allowance_usage (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  location_id     uuid references locations(id),    -- null when pooled at org level
  cycle_start     timestamptz not null,
  cycle_end       timestamptz not null,
  drops_used      integer not null default 0,
  created_at      timestamptz not null default now()
);

create unique index drop_allowance_usage_scope
  on drop_allowance_usage (org_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), cycle_start);

-- ---------------------------------------------------------------------------
-- §2.2 user_roles
-- The DATA-MODEL writes the primary key with a coalesce() expression.
-- Postgres does not allow expressions in a primary key, so it is a unique
-- index with identical semantics.
-- ---------------------------------------------------------------------------
create table user_roles (
  user_id      uuid not null references users(id) on delete cascade,
  role         user_role not null,
  org_id       uuid references organizations(id),   -- required for merchant_* roles
  location_id  uuid references locations(id),        -- required for merchant_staff
  granted_at   timestamptz not null default now(),
  granted_by   uuid references users(id),

  constraint merchant_roles_require_org
    check (role not in ('merchant_owner', 'merchant_staff') or org_id is not null),
  constraint staff_requires_location
    check (role <> 'merchant_staff' or location_id is not null),
  constraint owner_sees_all_locations
    check (role <> 'merchant_owner' or location_id is null)
);

create unique index user_roles_identity
  on user_roles (user_id, role, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index on user_roles (org_id) where org_id is not null;

-- ---------------------------------------------------------------------------
-- §3 addresses
-- ---------------------------------------------------------------------------
create table addresses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  label           text not null,                    -- 'Home', 'Work', 'Marriott Manhattan'
  line1           text not null,
  line2           text,
  city            text not null,
  region          text not null,
  postal_code     text not null,
  country         text not null default 'US',
  lat             numeric(9,6),
  lng             numeric(9,6),
  radius_miles    integer not null default 10,      -- per-address, not global
  is_home         boolean not null default false,
  created_at      timestamptz not null default now()
);

create unique index one_home_per_user on addresses (user_id) where is_home;
create index on addresses (user_id);
create index addresses_geo on addresses using gist (ll_to_earth(lat::float8, lng::float8));

alter table users add constraint fk_active_address
  foreign key (active_address_id) references addresses(id);
