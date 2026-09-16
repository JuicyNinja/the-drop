-- WP-14 admin portal.
--
-- Two schema additions:
--   1. users.clout_frozen_at — an admin freeze. Clout stops accruing from the
--      freeze moment (the recompute ignores the user's later events). The ledger
--      is untouched: freeze is not a grant, an adjustment, or a deletion
--      (invariant #6). A freeze is reversible (set the column back to null).
--   2. buyer_risk_profiles — INTERNAL, admin-only. It tracks cost imposed, not
--      virtue, and it FLAGS for human review. It never suspends anyone: no code
--      reads needs_review to act. A number that auto-suspends would suspend the
--      person whose car broke down twice. Decided in conversation 2026-09-16 and
--      recorded in the PRD and BUILD-PLAN.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Clout freeze
-- ---------------------------------------------------------------------------
alter table users add column clout_frozen_at timestamptz;
comment on column users.clout_frozen_at is
  'Admin clout freeze. When set, the clout recompute ignores this user''s events dated on/after this instant — accrual stops, the ledger is untouched, decay continues honestly. Null = not frozen. Reversible.';

-- ---------------------------------------------------------------------------
-- Buyer risk profile (admin-only). Derived and recomputable (upsert), not a
-- ledger. Minimum event counts gate every rate: below the minimum a rate is
-- null and cannot flag — two abandoned catches out of three is noise, two out
-- of two hundred is a pattern. Same reasoning as the top-1% clout cap being
-- unreachable below 100 users.
-- ---------------------------------------------------------------------------
create table buyer_risk_profiles (
  user_id                 uuid primary key references users(id) on delete restrict,

  -- Denominators (min-event gates read these).
  catches_total           integer not null default 0,
  redemptions_total       integer not null default 0,

  -- Cost signals.
  abandoned_catches       integer not null default 0,   -- caught, expired unredeemed
  redemption_rate         numeric(5,4),                  -- redeemed / caught; null until enough catches
  transfers_received_total integer not null default 0,   -- accepted transfers received
  distinct_transfer_senders integer not null default 0,  -- distinct accepted senders

  -- Low-weight POSITIVE signal (mitigating; never raises a flag).
  whisper_count           integer not null default 0,

  -- Phase 2 (WP-16) extends here. Nullable now, populated when payments land;
  -- the shape is fixed so WP-16 adds data, not columns.
  return_rate             numeric(5,4),
  chargeback_count        integer,
  dispute_loss_count      integer,

  -- Human-review flag. Thresholds set this; nothing auto-suspends on it.
  needs_review            boolean not null default false,
  review_reasons          text[]  not null default '{}',

  computed_at             timestamptz not null default now()
);

create index on buyer_risk_profiles (needs_review) where needs_review;

comment on table buyer_risk_profiles is
  'INTERNAL admin-only buyer risk. Tracks cost imposed, not virtue. Flags for human review; never auto-suspends. RLS: admin read only, no other role. Phase 2 (WP-16) fills return_rate/chargeback_count/dispute_loss_count.';

-- ---------------------------------------------------------------------------
-- RLS: admin read only. No other role may reach it — RLS denies, not code.
-- New tables inherit the WP-2 default-privilege revoke of writes from anon and
-- authenticated; the only mutator is the service role (the recompute job).
-- ---------------------------------------------------------------------------
-- SELECT is the gate here, and RLS decides the rows: the client roles hold the
-- SELECT privilege (as they do on every table) so that the admin-only policy —
-- not a blanket privilege revoke — is what admits an admin and denies everyone
-- else. This is the same posture as admin_audit_log, and it is what the WP-14
-- gate verifies by connecting AS anon, AS a non-admin, and AS an admin.
alter table buyer_risk_profiles enable row level security;
grant select on buyer_risk_profiles to anon, authenticated;

create policy buyer_risk_profiles_select on buyer_risk_profiles for select
  using (is_admin());
