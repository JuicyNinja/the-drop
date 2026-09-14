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

function prorate(priceCents: number, cycleEndsAt: string): number {
  const msLeft = new Date(cycleEndsAt).getTime() - Date.now();
  const daysLeft = Math.max(0, Math.min(CYCLE_DAYS, msLeft / (1000 * 60 * 60 * 24)));
  return Math.round(priceCents * (daysLeft / CYCLE_DAYS));
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
