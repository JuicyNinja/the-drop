-- WP-2 / DATA-MODEL §14 orders, invoicing, RMA (Phase 2) and §15 IP and
-- takedown (Phase 2). Defined now, unused in v1. No endpoints, no UI.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- §14 orders
-- ---------------------------------------------------------------------------
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
  created_at        timestamptz not null default now(),

  -- Tracking capture is the maker's only chargeback defense (PRD §15.1.4).
  constraint tracking_required_before_shipped
    check (status <> 'shipped' or tracking_number is not null)
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

-- ---------------------------------------------------------------------------
-- §14 rmas. refund_requires_receipt is invariant #16: no override, no bypass.
-- Restocking fees accrue to the maker. There is no platform-revenue column
-- in this table and none may be added (invariant #1).
-- ---------------------------------------------------------------------------
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

create index on rmas (order_id);

-- ---------------------------------------------------------------------------
-- §15 IP and takedown
-- ---------------------------------------------------------------------------
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
