-- WP-2 / DATA-MODEL §1. Extensions and enums.
-- Every enum for all three lanes exists from day one. Phases 2 and 3 are additive.

set search_path = public, extensions;

create extension if not exists citext        with schema extensions;
create extension if not exists cube          with schema extensions;
create extension if not exists earthdistance with schema extensions;
create extension if not exists pgcrypto      with schema extensions;

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

-- Phase 2
create type order_status as enum (
  'paid', 'shipped', 'delivered', 'rma_requested', 'rma_issued',
  'rma_denied', 'rma_in_transit', 'rma_received', 'refunded', 'cancelled'
);

create type rma_reason as enum ('vendor_error', 'buyer_error');

-- ---------------------------------------------------------------------------
-- Shared guard functions. Attached per table in later migrations.
-- ---------------------------------------------------------------------------

-- Rows in append-only tables are never removed. Fires for every role,
-- including the table owner and service_role; RLS alone would not reach them.
create or replace function forbid_row_delete() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only. Rows are never deleted.', tg_table_name
    using errcode = 'P0001';
end $$;

-- Rows in ledger tables are never changed after insert.
create or replace function forbid_row_update() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only. Rows are never updated.', tg_table_name
    using errcode = 'P0001';
end $$;
