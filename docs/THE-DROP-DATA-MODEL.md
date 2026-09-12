# THE DROP — DATA MODEL

**Version:** 1.0
**Companion to:** THE-DROP-PRD.md
**Database:** PostgreSQL (Supabase)

---

## 0. PRINCIPLES

1. **Schema is built for all three lanes now.** Maker Drop and DigiDrop tables, enums, and columns exist from day one. They are unused in v1. Phases 2 and 3 are additive, never migratory.
2. **Invariants live in the database, not the application.** Where the PRD says a rule is load-bearing, it is a constraint, a trigger, or a policy — not a code comment.
3. **Nothing that must be permanent is deletable.** Position numbers, user numbers, catches, redemptions, and Gone drops are append-only. Deletion is soft, via status.
4. **Money is never a percentage.** No table in this schema contains a commission rate, a take rate, or a platform fee on a transaction. If one appears, the model has been corrupted.
5. **All timestamps are `timestamptz`.** All money is `integer` cents. No floats, ever.

---

## 1. ENUMS

```sql
create type lane as enum ('local', 'maker', 'digital');

create type drop_status as enum (
  'draft', 'submitted', 'approved', 'rejected',
  'scheduled', 'live', 'gone', 'expired', 'encore_pending'
);

create type user_role as enum (
  'buyer', 'merchant_owner', 'merchant_staff',
  'maker', 'admin', 'field_rep'
);

create type follow_tier as enum ('follower', 'fanatic');

create type catch_status as enum (
  'held', 'transfer_pending', 'redeemed', 'expired'
);

create type redemption_method as enum ('gps_verified', 'unverified_timeout');

create type transfer_status as enum ('pending', 'accepted', 'declined', 'expired', 'voided');

create type clout_source as enum ('redemption', 'whisper', 'attributed_share');

create type org_status as enum ('active', 'past_due', 'suspended', 'delisted', 'cancelled');

create type subscription_tier as enum (
  'local_starter', 'local_limited', 'local_boss', 'local_superstar', 'local_enterprise',
  'maker_t1', 'maker_t2', 'maker_t3', 'maker_t4'
);
```

**Tier is a label, not a limit.** Actual allowances live in `organizations.max_locations`, `drops_per_cycle`, and `drops_pooled_org_level`. Never derive a limit from this enum — Enterprise carries arbitrary values, and tiers get repriced without a migration.

Allowances at time of writing:

| Tier | Locations | Drops/cycle | Pooled | Price |
|---|---|---|---|---|
| `local_starter` | 1 | 2 | no | $99 |
| `local_limited` | 1 | 8 | no | $149 |
| `local_boss` | 1 | 12 | no | $199 |
| `local_superstar` | 8 | 64 | **yes** | $795 |
| `local_enterprise` | custom | custom | custom | custom |
| `maker_t1` | — | 1 one-time | — | $99 |
| `maker_t2` | — | 2 | — | $149/mo |
| `maker_t3` | — | 4 | — | $349/mo |
| `maker_t4` | — | 8 | — | $795/mo |

```sql
-- Phase 2
create type order_status as enum (
  'paid', 'shipped', 'delivered', 'rma_requested', 'rma_issued',
  'rma_denied', 'rma_in_transit', 'rma_received', 'refunded', 'cancelled'
);

create type rma_reason as enum ('vendor_error', 'buyer_error');
```

---

## 2. IDENTITY

### 2.1 `users`

One row per human. Roles attach separately (§2.2). A merchant owner and a buyer are the same row.

```sql
create table users (
  id                uuid primary key default gen_random_uuid(),
  user_number       bigint unique not null,          -- 14-digit, sequential, immutable
  handle            citext unique not null,
  handle_changed_at timestamptz,                     -- non-null = permanently locked
  full_name         text not null,
  email             citext unique not null,
  email_verified_at timestamptz,
  phone             text unique not null,
  phone_verified_at timestamptz,
  active_address_id uuid,                            -- FK added after addresses (circular)
  location_perm_granted_at timestamptz,              -- hard gate; null = cannot catch/redeem
  suspended_at      timestamptz,
  suspension_reason text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create sequence user_number_seq start with 1;
create index on users (email);
create index on users (phone);
create index on users (user_number);
```

**User number formatting is a display concern.** Store as `bigint`, render zero-padded to 14 digits (`00000000000001`). Never store the padded string.

**Assignment:** `nextval('user_number_seq')` at insert. Never reassigned, never reused, never changed — including on account deletion. Account `1` is reserved for Tad Timothy, Founder.

**Handle immutability trigger:**

```sql
create or replace function enforce_handle_lock() returns trigger as $$
begin
  if old.handle is distinct from new.handle then
    if old.handle_changed_at is not null then
      raise exception 'Handle already changed once and is permanently locked';
    end if;
    new.handle_changed_at := now();
  end if;
  return new;
end $$ language plpgsql;

create trigger trg_handle_lock before update on users
  for each row execute function enforce_handle_lock();
```

**User number immutability:** enforced by trigger rejecting any UPDATE where `user_number` changes.

### 2.2 `user_roles`

```sql
create table user_roles (
  user_id      uuid not null references users(id) on delete cascade,
  role         user_role not null,
  org_id       uuid references organizations(id),   -- required for merchant_* roles
  location_id  uuid references locations(id),        -- required for merchant_staff
  granted_at   timestamptz not null default now(),
  granted_by   uuid references users(id),
  primary key (user_id, role, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
);
```

Every user implicitly holds `buyer`. `merchant_staff` MUST carry a `location_id`. `merchant_owner` MUST carry an `org_id` and no `location_id` (owner sees all locations).

### 2.3 `reserved_handles`

```sql
create table reserved_handles (
  handle citext primary key,
  reason text not null            -- 'brand' | 'profanity' | 'system'
);
```

---

## 3. ADDRESSES

```sql
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
create index addresses_geo on addresses using gist (ll_to_earth(lat, lng));

alter table users add constraint fk_active_address
  foreign key (active_address_id) references addresses(id);
```

**Active address governs discovery only.** It is never consulted during redemption. Redemption proximity is live GPS, always (§7.4 PRD).

**Radius is per-address.** 10 miles in SLC and 10 miles in Manhattan are different products.

---

## 4. MERCHANTS

### 4.1 `organizations`

Billing entity. Subscription attaches here.

```sql
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
```

**`drops_pooled_org_level`** is the Superstar/Enterprise branch. When true, the drop allowance is counted across all locations against `drops_per_cycle` on this row. When false, each location counts independently against its own allowance. This is the one place the billing model forks and it is the most common place to get it wrong.

**Limits are stored, not derived.** Enterprise accounts carry arbitrary values set by admin. Code that computes limits from `tier` will break Enterprise on day one.

### 4.2 `locations`

```sql
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
create index locations_geo on locations using gist (ll_to_earth(lat, lng));
```

### 4.3 `drop_allowance_usage`

Counter per billing cycle. Scoped to org or location depending on `drops_pooled_org_level`.

```sql
create table drop_allowance_usage (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  location_id     uuid references locations(id),    -- null when pooled at org level
  cycle_start     timestamptz not null,
  cycle_end       timestamptz not null,
  drops_used      integer not null default 0,
  created_at      timestamptz not null default now()
);

create unique index on drop_allowance_usage (org_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), cycle_start);
```

Incremented when a drop transitions to `scheduled`. **Never decremented** — a cancelled drop still consumed the allowance. Prevents create/cancel cycling to farm free drops.

---

## 5. TAXONOMY

```sql
create table tags (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references tags(id),   -- null = top-level group
  slug        text unique not null,
  label       text not null,
  synonyms    text[] not null default '{}',
  lanes       lane[] not null default '{}',   -- empty on group rows
  selectable  boolean not null default true,  -- false on group rows
  active      boolean not null default true,
  sort_order  integer not null default 0,

  constraint groups_not_selectable
    check (parent_id is not null or selectable = false),
  constraint leaves_have_lanes
    check (parent_id is null or array_length(lanes, 1) >= 1)
);

create index on tags (parent_id) where active;
create index tags_lanes on tags using gin (lanes);
-- array_to_string(text[], text) is only STABLE, and Postgres refuses any
-- non-IMMUTABLE function in an index expression (SQLSTATE 42P17). The search
-- document is therefore built by an IMMUTABLE wrapper, and the index is on
-- the wrapper. See "tag_search_document" below.
create or replace function tag_search_document(label text, synonyms text[])
returns tsvector
language sql immutable parallel safe as $$
  select to_tsvector('simple', label || ' ' || coalesce(array_to_string(synonyms, ' '), ''));
$$;

create index tags_search on tags using gin (tag_search_document(label, synonyms));

create table user_tags (
  user_id uuid not null references users(id) on delete cascade,
  tag_id  uuid not null references tags(id),
  primary key (user_id, tag_id)
);

create table org_tags (
  org_id uuid not null references organizations(id) on delete cascade,
  tag_id uuid not null references tags(id),
  primary key (org_id, tag_id)
);
```

**`tag_search_document` — the only way to hit `tags_search`.** The index is built on `tag_search_document(label, synonyms)`, not on an inline `to_tsvector(...)` expression, because `array_to_string` is STABLE and Postgres rejects it in an index expression (found on first apply during WP-2, SQLSTATE 42P17). Postgres matches an expression index only when the query expression is textually identical to the indexed one. Any query against the taxonomy search index MUST therefore be written as:

```sql
where tag_search_document(label, synonyms) @@ to_tsquery('simple', $1)
```

A query that inlines `to_tsvector('simple', label || ' ' || array_to_string(synonyms, ' '))` is semantically identical and bypasses the index entirely. It will look fine at 478 rows and degrade silently as the taxonomy grows. The WP-11 gate verifies the type-ahead query with EXPLAIN.

### 5.1 One taxonomy, two jobs

The same table serves buyer interest matching and merchant classification. This is deliberate: a buyer who marks **Tacos** as an interest and a merchant who classifies as **Tacos** must resolve to the same node, or notification matching and browse filtering will disagree with each other. Two taxonomies cannot be kept in sync by hand and will not be.

### 5.2 Two levels

Top-level rows (`parent_id is null`) are **groups** — browsable chips, never selectable by a merchant or buyer. Leaves are what gets chosen and what type-ahead resolves to.

```
Food & Drink    → Tacos · Wings · Coffee · Brunch · Pizza · Sushi · BBQ …
Auto            → Oil Change · Detail · Tires · Car Wash · Body Work …
Home Services   → Window Washing · Carpet · Lawn · Pressure Wash · Gutters …
Personal Care   → Barber · Nails · Massage · Lashes · Spa …
Cleaning        → Dry Cleaning · Laundry · Alterations …
Entertainment   → Bowling · Golf · Climbing · Escape Room · Arcade …
Retail          → Jewelry · Apparel · Footwear · Home Goods …
```

Hundreds of leaves remain usable because nobody scrolls them — they type.

### 5.3 Synonyms are load-bearing

A merchant classified as **Auto Detail** is invisible to a buyer typing "car wash" unless the taxonomy carries the mapping. `synonyms` is what makes type-ahead work, and it is the difference between the filter functioning and not.

Seed every leaf with its common alternates at launch. Admin adds more as search misses surface in the analytics.

### 5.4 One node, many lanes — never duplicated

`lanes` is an **array**, not a single value. A category that exists in more than one lane is **one row**, never two.

Jewelry is a single tag carrying `{local,maker}`. It surfaces under Retail in the Local lane and under Retail in the Maker lane — same node, same ID, same synonyms, same analytics. A buyer who marks Jewelry as an interest is matched on both lanes.

Duplicating a category per lane would split its analytics, split its notification matching, and require every synonym edit to be made twice. It is forbidden.

Each lane's browse surface filters to `lanes @> ARRAY['local']::lane[]` or equivalent. The GIN index on `lanes` serves this.

### 5.5 No free-text, anywhere

Merchants select from this taxonomy. Buyers select from this taxonomy. Type-ahead searches this taxonomy — **never drop titles or descriptions.**

Free-text search over drop content would reward keyword-stuffed titles, return junk, and hand merchants a new surface to game. A closed taxonomy gives clean filtering, clean analytics, and no gaming surface.

### 5.6 Seed data

Ship `supabase/seed/taxonomy-seed.sql` — **24 groups, 454 leaves, 1,305 synonyms.** Generated from `taxonomy/source.py`; edit the source and regenerate rather than hand-editing the SQL.

Lane coverage: 413 local, 115 maker, 52 digital (leaves overlap across lanes).

**Synonym collisions are expected and correct.** "wax" resolves to both Waxing & Hair Removal and Ski & Board Tuning; "nursery" to both Garden Center and Childcare. Type-ahead MUST display the parent group alongside each result so the buyer disambiguates visually — that is why `matched_on` and `group` are in the search response.

**No free-text tags anywhere.** The taxonomy is platform-controlled and admin-managed (PRD §10.1). Free-text destroys matching immediately.

---

## 6. CITIES

```sql
create table cities (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  region                  text not null,
  country                 text not null default 'US',
  lat                     numeric(9,6) not null,
  lng                     numeric(9,6) not null,
  launched_at             timestamptz,
  default_geofence_m      integer not null default 150,
  coldstart_days          integer not null default 30,
  coldstart_min_events    integer not null default 500,
  active                  boolean not null default false
);
```

Cold-start fallback ordering applies until `coldstart_days` elapse **or** `coldstart_min_events` are recorded, whichever comes first (PRD §10.3).

---

## 7. DROPS

### 7.1 `drops`

```sql
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
  restocking_fee_bps    integer default 2000,            -- 20.00% — PRD §15.1.3

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
```

### 7.2 Immutability after live — DOCTRINE, enforced by trigger

```sql
create or replace function enforce_live_immutability() returns trigger as $$
begin
  if old.status in ('live','gone','expired') then
    if new.quantity_total  is distinct from old.quantity_total
    or new.price_cents     is distinct from old.price_cents
    or new.terms           is distinct from old.terms
    or new.redeem_from     is distinct from old.redeem_from
    or new.redeem_until    is distinct from old.redeem_until
    or new.title           is distinct from old.title
    or new.description     is distinct from old.description then
      raise exception 'Drop is immutable once live. Create an Encore instead.';
    end if;
  end if;
  return new;
end $$ language plpgsql;

create trigger trg_live_immutability before update on drops
  for each row execute function enforce_live_immutability();
```

`quantity_remaining` is deliberately excluded — it is the only mutable field after go-live, and it MUST only ever decrease. Enforced separately:

```sql
create or replace function enforce_counter_never_rises() returns trigger as $$
begin
  if old.status = 'live' and new.quantity_remaining > old.quantity_remaining then
    raise exception 'Counters never go up. Create an Encore.';
  end if;
  return new;
end $$ language plpgsql;

create trigger trg_counter_monotonic before update on drops
  for each row execute function enforce_counter_never_rises();
```

### 7.3 State transition guard

Valid transitions only. Enforced by trigger against a transition table:

```
draft        → submitted | scheduled        (scheduled direct: lane='local' only)
submitted    → approved | rejected
approved     → scheduled
scheduled    → live | draft
live         → gone | expired
gone         → encore_pending
```

**Local drops skip `submitted`/`approved` entirely** — auto-publish (PRD §4.2). A trigger MUST reject `lane='local'` drops entering `submitted` or `approved`.

---

## 8. THE CATCH

### 8.1 `catches`

```sql
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

  constraint one_catch_per_buyer_per_drop
    unique (drop_id, original_user_id),
  constraint position_unique_per_drop
    unique (drop_id, position_number),
  constraint max_one_hop
    check (transfer_count <= 1)
);

create index on catches (user_id, status);
create index on catches (drop_id, position_number);
create index on catches (expires_at) where status in ('held','transfer_pending');
```

**`one_catch_per_buyer_per_drop` is keyed on `original_user_id`, not `user_id`.** This is deliberate: a buyer must not be able to catch, transfer away, and catch again. The unique constraint on the original catcher prevents it.

**Position numbers are permanent and never reused.** `position_unique_per_drop` makes collision impossible at the database level. Gaps are permitted and expected (PRD §5.3).

**No delete, ever.** Catches are append-only. Expiry is a status change.

### 8.2 The catch contract — Redis + Postgres

Drop-open is a thundering herd. Postgres alone would serialize on row locks and oversell under retry.

**At go-live**, seed Redis:
```
SET drop:{drop_id}:inventory {quantity_total}
SET drop:{drop_id}:until {redeem_until_epoch}
EXPIRE drop:{drop_id}:inventory {ttl}
```

**On catch request:**
```
position = DECR drop:{drop_id}:inventory
```

`DECR` is atomic and returns the post-decrement value. Derive position:

```
position_number = quantity_total - position
```

- `position < 0` → **Gone.** Reject immediately. No database round trip. Do not re-increment.
- `position >= 0` → proceed. Write the catch row asynchronously.

**A failed Postgres write burns the position number.** It is never reclaimed and never reused. Gaps are correct behavior (PRD §5.3).

**Idempotency:** the client sends a request UUID. Redis holds `SETNX catch:req:{uuid}` with a short TTL. A retried request returns the original result rather than consuming a second unit.

**Reconciliation:** a background job compares `quantity_total - count(catches)` against Redis inventory, logs drift, and writes `quantity_remaining` to Postgres for the board. **The job never increases `quantity_remaining`** and never writes inventory back to Redis.

### 8.3 `redemptions`

```sql
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
```

`catch_id` is **unique** — one redemption per catch, enforced by the database.

`method = 'unverified_timeout'` is the 7-second GPS-failure auto-redeem (PRD §7.5). Rate-limited per user, surfaced in the admin fraud review, and shown as unverified in the merchant live feed. Never visible to the customer.

---

## 9. TRANSFERS

```sql
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
```

**Rules enforced at write time:**

| Rule | Enforcement |
|---|---|
| One hop | `catches.transfer_count <= 1` check constraint |
| 5-minute accept window | `accept_by = sent_at + interval '5 minutes'`; sweeper expires |
| 30-min pre-close cutoff | Reject send if `now() > drop.redeem_until - interval '30 minutes'` |
| Decline returns to sender | Status `declined`; `catches.user_id` unchanged |
| No orphans | If `drop.redeem_until` passes while `pending`, set `voided`; catch expires with the window |
| Position travels | `catches.position_number` untouched by transfer |
| Clout does not travel | Clout writes on redemption, keyed to `redemptions.user_id` |

A sweeper job runs every 30 seconds against `accept_by` and `redeem_until` to resolve `pending` transfers. **Transfers must not rely on client-side timers.**

---

## 10. FOLLOWS

```sql
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
```

**Fanatic cap: 10 per lane, independent pools** (PRD §9.1). Enforced by trigger:

```sql
create or replace function enforce_fanatic_cap() returns trigger as $$
declare n integer;
begin
  if new.tier = 'fanatic' then
    select count(*) into n from follows
      where user_id = new.user_id and lane = new.lane and tier = 'fanatic'
        and org_id <> new.org_id;
    if n >= 10 then
      raise exception 'Fanatic limit reached for this lane (10). Free a slot first.';
    end if;
  end if;
  return new;
end $$ language plpgsql;

create trigger trg_fanatic_cap before insert or update on follows
  for each row execute function enforce_fanatic_cap();
```

Fanatic is opt-in only. No mechanism exists — and none may be added — for a merchant to promote a user into Fanatic status.

---

## 11. CLOUT, BADGES, WHISPERS

### 11.1 `clout_events`

Append-only ledger. Score is derived, never stored as a mutable total.

```sql
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
```

**Only three sources produce clout** (PRD §10.4): completed redemption, whisper, attributed share. There is **no admin grant path and no purchase path.** Any code that inserts a `clout_events` row from a payment, a subscription, or a promotional action is a doctrine violation.

### 11.2 `clout_scores`

Materialized, recomputed on schedule. Decay and the top-1%-per-city cap apply here.

```sql
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
```

Tier 5 is capped at the top 1% per city by `percentile`.

### 11.3 `share_links`

Attribution for clout from social sharing. **Tracked links only in v1** — platform API verification is deferred (PRD §10.4).

```sql
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
```

Clout is granted only when a share link produces a verified return click. Unverifiable content earns nothing.

### 11.4 `badges` / `user_badges`

Permanent achievements. **Separate system from clout** — badges do not decay and are not capped.

```sql
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
```

### 11.5 `whispers`

```sql
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
```

**Read-only for merchants. Never public.** No API endpoint may expose a whisper to any party other than the authoring buyer, the owning merchant, and admin.

### 11.6 `merchant_scores`

Trailing redemption quality. **Not a ranking input** — surfaced on drop detail and business listing (PRD §10.2).

```sql
create table merchant_scores (
  org_id            uuid primary key references organizations(id) on delete cascade,
  redemption_rate   numeric(5,4) not null,      -- redemptions / catches, trailing window
  whisper_score     numeric(5,4),
  drops_counted     integer not null,
  computed_at       timestamptz not null default now()
);
```

New merchants start at the cohort median so they are neither punished nor gameable.

---

## 12. RANKING

```sql
create table drop_pressure (
  drop_id           uuid primary key references drops(id) on delete cascade,
  views             integer not null default 0,
  catches           integer not null default 0,
  pct_remaining     numeric(5,4) not null,       -- THE ranking metric
  computed_at       timestamptz not null default now()
);

create index on drop_pressure (pct_remaining asc);
```

**Ranking metric is `pct_remaining` ascending.** Lower remaining = hotter (PRD §10.2).

Percentage, never absolute count — a 10-unit drop must not permanently outrank a 200-unit drop at equivalent sell-through.

The drop card displays **both** absolute remaining and percentage. Only percentage ranks.

**Merchant redemption rate is not in this table.** It is not a ranking input.

**Cold start:** when the drop's city is inside its cold-start window (PRD §10.3), ordering falls back to proximity for `lane='local'` and fill-screen for maker/digital.

---

## 13. NOTIFICATIONS

```sql
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
```

**No quiet hours table exists.** There are no quiet hours (PRD §9.4). A user who made a bar a Fanatic asked for the 11pm alert.

Transfer notifications are SMS regardless of follow tier and regardless of `sms_enabled` — the flow is user-initiated with a 5-minute clock and no other channel works.

---

## 14. PHASE 2 — ORDERS, INVOICING, RMA

Defined now. Unused in v1.

```sql
create table orders (
  id                uuid primary key default gen_random_uuid(),
  catch_id          uuid not null unique references catches(id),
  drop_id           uuid not null references drops(id),
  buyer_id          uuid not null references users(id),
  org_id            uuid not null references organizations(id),
  status            order_status not null default 'paid',

  subtotal_cents    integer not null,
  shipping_cents    integer not null default 0,
  tax_cents         integer not null default 0,
  total_cents       integer not null,

  ship_to           jsonb not null,
  carrier           text,
  tracking_number   text,                       -- MANDATORY before status='shipped'
  shipped_at        timestamptz,
  delivered_at      timestamptz,

  stripe_payment_intent_id text,
  created_at        timestamptz not null default now()
);

create index on orders (org_id, created_at desc);
create index on orders (buyer_id, created_at desc);
create index on orders (drop_id);

create table invoices (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null unique references orders(id),
  number        text unique not null,
  line_items    jsonb not null,
  total_cents   integer not null,
  issued_at     timestamptz not null default now()
);

create table rmas (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references orders(id),
  reason                rma_reason not null,
  restocking_fee_cents  integer not null default 0,
  refund_amount_cents   integer not null,
  requested_at          timestamptz not null default now(),
  issued_at             timestamptz,
  denied_at             timestamptz,
  denial_reason         text,
  received_at           timestamptz,              -- REFUND GATE
  refunded_at           timestamptz,
  stripe_refund_id      text,

  constraint refund_requires_receipt
    check (refunded_at is null or received_at is not null),
  constraint vendor_error_no_fee
    check (reason <> 'vendor_error' or restocking_fee_cents = 0)
);
```

**`refund_requires_receipt` is invariant #16.** No refund may be issued before the product is physically received. Enforced at the database layer, no override path, no admin bypass.

**`vendor_error_no_fee`** — vendor-error returns are 100% including original shipping. Buyer-error returns retain 20% (PRD §15.1.3).

**Restocking fees accrue to the maker, not the platform.** There is no platform-revenue column in this table and none may be added — that would couple platform revenue to transaction volume and break invariant #1.

**Tracking capture is mandatory** before `status = 'shipped'` — it is the maker's only chargeback defense (PRD §15.1.4).

---

## 15. IP AND TAKEDOWN (Phase 2)

```sql
create table maker_agreements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  org_id        uuid not null references organizations(id),
  version       text not null,
  agreed_at     timestamptz not null default now(),
  ip_address    inet,
  user_agent    text
);

create table takedown_notices (
  id              uuid primary key default gen_random_uuid(),
  drop_id         uuid references drops(id),
  org_id          uuid references organizations(id),
  claimant_name   text not null,
  claimant_email  text not null,
  claim_body      text not null,
  received_at     timestamptz not null default now(),
  removed_at      timestamptz,
  counter_notice  text,
  counter_at      timestamptz,
  resolved_at     timestamptz,
  resolution      text
);

create table infringement_strikes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id),
  notice_id   uuid references takedown_notices(id),
  issued_at   timestamptz not null default now()
);
```

Agreements are versioned and timestamped with IP and user agent — an unversioned agreement is unenforceable. Strikes back the repeat-infringer policy, which is a **condition of DMCA safe harbor** (PRD §15.2.3) and must be applied consistently and logged.

---

## 16. ADMIN AUDIT

```sql
create table admin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid not null references users(id),
  action        text not null,
  target_type   text not null,
  target_id     uuid,
  before        jsonb,
  after         jsonb,
  ip_address    inet,
  occurred_at   timestamptz not null default now()
);

create index on admin_audit_log (actor_id, occurred_at desc);
create index on admin_audit_log (target_type, target_id);
```

**Every admin action writes here.** Field reps and 1099 contractors touch accounts in Phase 2; an unlogged admin panel is a liability and this is painful to retrofit.

---

## 17. ROW-LEVEL SECURITY

RLS is enabled on every table. Baseline policies:

| Table | Policy |
|---|---|
| `users` | Self read/write. Admin full. Public read limited to `handle`, `user_number`, clout tier, badges. |
| `addresses` | Self only. Never exposed to merchants. |
| `catches` | Current holder reads own. Merchant reads catches on their own drops. |
| `redemptions` | Redeeming user + owning org + admin. |
| `whispers` | Author + owning org + admin. **Never public, no exceptions.** |
| `clout_events` | Self read only. **No insert path from any client.** Server-side only. |
| `transfers` | Sender + recipient + admin. |
| `orders` / `rmas` | Buyer + owning org + admin. |
| `admin_audit_log` | Admin read. **No update or delete policy on any role.** |

`clout_events` and `admin_audit_log` are append-only at the policy level. No role, including admin, may update or delete either.

---

## 18. SCHEDULED JOBS

| Job | Cadence | Purpose |
|---|---|---|
| Drop go-live | 15s | `scheduled` → `live`; seed Redis inventory |
| Drop close | 15s | `live` → `gone` \| `expired` |
| Transfer sweeper | 30s | Expire past `accept_by`; void past `redeem_until` |
| Catch expiry | 60s | `held` → `expired` past `expires_at` |
| Inventory reconcile | 60s | Redis vs. Postgres drift; write `quantity_remaining` (decrease only) |
| Pressure recompute | 60s | `drop_pressure.pct_remaining` |
| Redemption-closing notify | 5m | Default 2h before `redeem_until` |
| Clout recompute | hourly | Decay, percentile, tier |
| Merchant score recompute | daily | Trailing redemption rate |
| Daily digest | hourly | Per-user at `digest_hour_local` |
| Cycle rollover | hourly | 30-day anniversary; new `drop_allowance_usage` row |

---

*End of DATA-MODEL v1.0*
