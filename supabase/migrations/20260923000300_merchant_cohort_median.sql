-- Surface the cohort median alongside the merchant redemption rate (PRD §10.2).
--
-- "87% redeemed" on its own is meaningless; "87% redeemed — typical is 64%" is
-- the signal doing its job. The cohort median is already computed on every
-- recompute (lib/merchant-score.ts) but was never stored, so it could not be
-- shown. Store it on each score row — the same platform-wide value per run (the
-- cohort is the orgs that have data) — so the board and detail can display it.

alter table merchant_scores add column if not exists cohort_median numeric;
