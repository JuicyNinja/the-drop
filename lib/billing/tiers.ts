import { ApiError } from "@/lib/api/errors";

/**
 * The subscription tier catalog: published allowances and prices.
 *
 * This is PRESENTATION and SEED data only. It is used in exactly two places:
 * to seed an org's stored limit columns at creation, and to build the
 * upgrade_options in a 402 payload. Enforcement NEVER reads it — enforcement
 * always reads the stored columns on the organizations row (invariant: limits
 * are stored, not derived; Enterprise carries arbitrary values). A repricing
 * changes this table without a migration and without touching any live org.
 */

export type LocalTier =
  | "local_starter"
  | "local_limited"
  | "local_boss"
  | "local_superstar"
  | "local_enterprise";

export interface TierSpec {
  tier: LocalTier;
  max_locations: number | null; // null = custom (enterprise)
  drops_per_cycle: number | null;
  pooled: boolean;
  price_cents: number | null; // null = call for pricing
  rank: number;
}

export const TIER_CATALOG: Record<LocalTier, TierSpec> = {
  local_starter: { tier: "local_starter", max_locations: 1, drops_per_cycle: 2, pooled: false, price_cents: 9900, rank: 1 },
  local_limited: { tier: "local_limited", max_locations: 1, drops_per_cycle: 8, pooled: false, price_cents: 14900, rank: 2 },
  local_boss: { tier: "local_boss", max_locations: 1, drops_per_cycle: 12, pooled: false, price_cents: 19900, rank: 3 },
  local_superstar: { tier: "local_superstar", max_locations: 8, drops_per_cycle: 64, pooled: true, price_cents: 79500, rank: 4 },
  local_enterprise: { tier: "local_enterprise", max_locations: null, drops_per_cycle: null, pooled: true, price_cents: null, rank: 5 },
};

const CYCLE_DAYS = 30;

/** Self-serve tiers whose limits are seeded from the catalog at creation. */
export function isSelfServeTier(tier: string): tier is Exclude<LocalTier, "local_enterprise"> {
  return tier in TIER_CATALOG && tier !== "local_enterprise";
}

export interface SeededLimits {
  max_locations: number;
  drops_per_cycle: number;
  pooled: boolean;
}

/** Limits to store for a self-serve tier at org creation. */
export function seedLimitsFor(tier: string): SeededLimits {
  const spec = TIER_CATALOG[tier as LocalTier];
  if (!spec || spec.max_locations === null || spec.drops_per_cycle === null) {
    throw new ApiError("VALIDATION_ERROR", "Unknown or non-self-serve tier.", {
      body: [{ path: "tier", message: "not self-serve" }],
    });
  }
  return { max_locations: spec.max_locations, drops_per_cycle: spec.drops_per_cycle, pooled: spec.pooled };
}

export function prorate(priceCents: number, cycleEndsAt: string): number {
  const msLeft = new Date(cycleEndsAt).getTime() - Date.now();
  const daysLeft = Math.max(0, Math.min(CYCLE_DAYS, msLeft / (1000 * 60 * 60 * 24)));
  return Math.round(priceCents * (daysLeft / CYCLE_DAYS));
}

/**
 * Annual contracts (PRD §12.2, §12.4). Annual is billed at 10× the monthly rate
 * — two months free. The introductory offer is $9/month for the first three
 * months of the term, then the annual monthly rate (annual ÷ 12) for the
 * remaining nine. One twelve-month term; the intro lives inside it. Like the
 * rest of this file, these are presentation/pricing values — enforcement reads
 * the stored org columns, never this table.
 */
export const ANNUAL_MULTIPLE = 10; // 10× monthly = two months free
export const INTRO_MONTHLY_CENTS = 900; // $9/month
export const INTRO_MONTHS = 3;
export const TERM_MONTHS = 12;

/** Annual contract price for a tier (10× monthly), or null for call-for-pricing. */
export function annualPriceCents(tier: string): number | null {
  const p = TIER_CATALOG[tier as LocalTier]?.price_cents;
  return p == null ? null : p * ANNUAL_MULTIPLE;
}

/** The annual monthly rate — annual price ÷ 12 (e.g. Starter $990 ÷ 12 = $82.50). */
export function annualMonthlyCents(tier: string): number | null {
  const annual = annualPriceCents(tier);
  return annual == null ? null : Math.round(annual / TERM_MONTHS);
}

export interface AnnualIntroPricing {
  annual_price_cents: number; // 10× monthly
  annual_monthly_cents: number; // annual ÷ 12
  intro_monthly_cents: number; // $9
  intro_months: number; // 3
  charge_now_cents: number; // the first month's charge under the intro ($9)
  month_charge_cents: number[]; // the 12-month schedule: [900,900,900, annualMonthly×9]
  year_total_cents: number; // sum of the schedule (Starter: 76950 = $769.50)
}

/**
 * The full 12-month charge schedule for an annual contract taken with the intro.
 * The intro is inside the term, so month 4 is a billing change, not a decision.
 * Returns null for a tier with no self-serve price (enterprise).
 */
export function annualIntroPricing(tier: string): AnnualIntroPricing | null {
  const annual = annualPriceCents(tier);
  const monthly = annualMonthlyCents(tier);
  if (annual == null || monthly == null) return null;
  const schedule = [
    ...Array<number>(INTRO_MONTHS).fill(INTRO_MONTHLY_CENTS),
    ...Array<number>(TERM_MONTHS - INTRO_MONTHS).fill(monthly),
  ];
  return {
    annual_price_cents: annual,
    annual_monthly_cents: monthly,
    intro_monthly_cents: INTRO_MONTHLY_CENTS,
    intro_months: INTRO_MONTHS,
    charge_now_cents: INTRO_MONTHLY_CENTS,
    month_charge_cents: schedule,
    year_total_cents: schedule.reduce((a, b) => a + b, 0),
  };
}

export interface UpgradeOption {
  tier: LocalTier;
  max_locations?: number;
  drops_per_cycle?: number;
  price_cents: number;
  prorated_now_cents: number;
}

/**
 * Tiers above the current one that increase the given resource. `resource`
 * picks which field the caller was blocked on, so the options are relevant.
 */
export function upgradeOptions(
  currentTier: string,
  resource: "locations" | "drops",
  cycleEndsAt: string,
): { options: UpgradeOption[]; enterprise_contact: boolean } {
  const current = TIER_CATALOG[currentTier as LocalTier];
  const currentRank = current?.rank ?? 0;
  const options: UpgradeOption[] = [];
  for (const spec of Object.values(TIER_CATALOG)) {
    if (spec.rank <= currentRank) continue;
    if (spec.price_cents === null) continue; // enterprise: contact, not an option
    const opt: UpgradeOption = {
      tier: spec.tier,
      price_cents: spec.price_cents,
      prorated_now_cents: prorate(spec.price_cents, cycleEndsAt),
    };
    if (resource === "locations" && spec.max_locations !== null) opt.max_locations = spec.max_locations;
    if (resource === "drops" && spec.drops_per_cycle !== null) opt.drops_per_cycle = spec.drops_per_cycle;
    options.push(opt);
  }
  // Enterprise is the path when nothing self-serve is higher (or already there).
  const enterprise_contact = options.length === 0 || currentTier === "local_enterprise";
  return { options, enterprise_contact };
}
