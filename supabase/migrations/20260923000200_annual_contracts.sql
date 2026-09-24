-- Annual contracts + introductory offer (PRD §12.2, §12.4).
--
-- billing_interval records whether the org is on a monthly or annual contract.
-- annual_started_at anchors the twelve-month term and, from it, the three-month
-- $9/mo intro window (months 1-3 vs the annual monthly rate for 4-12). Pricing
-- lives in the catalog (lib/billing/tiers.ts) and is never derived here; these
-- columns are the per-org contract state, alongside the stored limit columns.

alter table organizations
  add column if not exists billing_interval text not null default 'monthly'
    check (billing_interval in ('monthly', 'annual')),
  add column if not exists annual_started_at timestamptz;
