-- WP-2 / DATA-MODEL §6 cities, §2 identity.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- §6 cities (before locations, which reference it)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- §2.1 users
-- ---------------------------------------------------------------------------
create sequence user_number_seq start with 1;

-- users.id IS the Supabase Auth uid (decision 2026-09-12): one id per human.
-- The auth uid is internal plumbing. It is never displayed and never in a URL;
-- user_number and handle are the public identity.
--
-- on delete restrict: deleting an auth user can never remove a users row.
-- Catches, redemptions, clout events, and position numbers are permanent
-- (CLAUDE.md invariants 2, 4, 14). Account deletion is a status change
-- (deleted_at), never a row removal, and user_number is never reassigned.
create table users (
  id                uuid primary key references auth.users(id) on delete restrict,
  user_number       bigint unique not null default nextval('user_number_seq'),  -- 14-digit, sequential, immutable
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
  deleted_at        timestamptz,                     -- account deletion is a status, never a row removal
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter sequence user_number_seq owned by users.user_number;

create index on users (email);
create index on users (phone);
create index on users (user_number);

-- Handle immutability: one change, ever.
create or replace function enforce_handle_lock() returns trigger
language plpgsql as $$
begin
  if old.handle is distinct from new.handle then
    if old.handle_changed_at is not null then
      raise exception 'Handle already changed once and is permanently locked'
        using errcode = 'P0001';
    end if;
    new.handle_changed_at := now();
  end if;
  return new;
end $$;

create trigger trg_handle_lock before update on users
  for each row execute function enforce_handle_lock();

-- User number immutability: never reassigned, never reused, never changed.
create or replace function enforce_user_number_immutable() returns trigger
language plpgsql as $$
begin
  if new.user_number is distinct from old.user_number then
    raise exception 'user_number is permanent and never changes'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger trg_user_number_immutable before update on users
  for each row execute function enforce_user_number_immutable();

-- Users rows are never removed. Deletion is deleted_at.
create trigger trg_users_no_delete before delete on users
  for each row execute function forbid_row_delete();

-- ---------------------------------------------------------------------------
-- §2.3 reserved_handles
-- ---------------------------------------------------------------------------
create table reserved_handles (
  handle citext primary key,
  reason text not null            -- 'brand' | 'profanity' | 'system'
);
