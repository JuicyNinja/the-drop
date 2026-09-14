import { ApiError } from "@/lib/api/errors";
import {
  claimIdempotencyKey,
  getIdempotencyResult,
  storeIdempotencyResult,
} from "@/lib/redis";
import { getServiceClient } from "@/lib/supabase/server";
import { currentCycle } from "@/lib/billing/allowance";
import { TIER_CATALOG, isSelfServeTier, prorate, seedLimitsFor, type LocalTier } from "@/lib/billing/tiers";
import { getSubscriptionGateway } from "@/lib/billing/subscription";
import type { OrgRecord } from "@/lib/orgs";

/**
 * The one-click prorated upgrade behind the soft block. Real (not a stub): it
 * recomputes the org's stored limit columns from the TARGET tier's catalog,
 * sets the tier and subscription id, and the merchant is unblocked in the same
 * request. Idempotent via the same Idempotency-Key pattern as the catch
 * contract, so a double-clicked upgrade neither charges twice nor double-applies.
 *
 * Downgrade is intentionally NOT built in WP-6 (see the report / build plan).
 */

export interface UpgradeResponse {
  subscription_id: string;
  charged_cents: number;
  new_tier: string;
  limits: { max_locations: number; drops_per_cycle: number; drops_pooled_org_level: boolean };
  cycle_ends_at: string;
}

export async function upgradeSubscription(
  org: OrgRecord,
  targetTier: string,
  idempotencyKey: string,
): Promise<UpgradeResponse> {
  const key = `upgrade:${org.id}:${idempotencyKey}`;

  // Idempotency: first caller does the work; a replay returns the stored result.
  const won = await claimIdempotencyKey(key);
  if (!won) {
    const prior = await getIdempotencyResult<UpgradeResponse>(key);
    if (prior && prior !== "pending") return prior;
    throw new ApiError("RATE_LIMITED", "An upgrade for this request is already in progress. Retry shortly.");
  }

  // Self-serve upgrades only, strictly upward. Enterprise stays admin.
  if (!isSelfServeTier(targetTier)) {
    throw new ApiError("VALIDATION_ERROR", "That tier is not self-serve.", { body: [{ path: "target_tier", message: "not self-serve" }] });
  }
  const currentRank = TIER_CATALOG[org.tier as LocalTier]?.rank ?? 0;
  const targetSpec = TIER_CATALOG[targetTier as LocalTier];
  if (targetSpec.rank <= currentRank) {
    throw new ApiError("VALIDATION_ERROR", "Downgrades and lateral changes are not supported.", { body: [{ path: "target_tier", message: "not an upgrade" }] });
  }

  const cycle = currentCycle(org.cycle_anchor_at);
  const proratedCents = prorate(targetSpec.price_cents ?? 0, cycle.end);

  const gatewayResult = await getSubscriptionGateway().upgrade({
    orgId: org.id,
    fromTier: org.tier,
    toTier: targetTier,
    proratedCents,
  });

  const limits = seedLimitsFor(targetTier);
  const { error } = await getServiceClient()
    .from("organizations")
    .update({
      tier: targetTier,
      max_locations: limits.max_locations,
      drops_per_cycle: limits.drops_per_cycle,
      drops_pooled_org_level: limits.pooled,
      stripe_subscription_id: gatewayResult.subscription_id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", org.id);
  if (error) throw new Error(`apply upgrade failed: ${error.message}`);

  const response: UpgradeResponse = {
    subscription_id: gatewayResult.subscription_id,
    charged_cents: gatewayResult.charged_cents,
    new_tier: targetTier,
    limits: { max_locations: limits.max_locations, drops_per_cycle: limits.drops_per_cycle, drops_pooled_org_level: limits.pooled },
    cycle_ends_at: cycle.end,
  };
  await storeIdempotencyResult(key, response);
  return response;
}
