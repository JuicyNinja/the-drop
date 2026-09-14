import { getServiceClient } from "@/lib/supabase/server";

/**
 * Clout ledger writes. WP-8 writes the redemption source event; WP-10 builds
 * recompute, decay, tiers, and percentile ON TOP of this append-only ledger
 * and owns every derived value. WP-8 writes nothing but the row.
 *
 * Points are a named constant, tuned in one place (WP-10 will revise it).
 * `clout_events` is append-only and server-only; the redemption path is
 * idempotent and the redemption↔catch is unique, so one redemption writes one
 * clout row.
 */
export const CLOUT_POINTS = {
  /** A completed redemption. Unverified (timeout) redemptions earn this too —
   *  the rate limit is the fraud control; denying clout would punish a buyer
   *  for a basement with no signal (WP-8 decision, recorded in the report). */
  redemption: 10,
} as const;

/**
 * Record the clout event for a completed redemption. City is the MERCHANT
 * location's city, never the buyer's address (clout is capped per city; taking
 * the buyer's city would let a thin market be farmed from anywhere). Returns
 * the points recorded.
 */
export async function recordRedemptionClout(
  userId: string,
  cityId: string | null,
  redemptionId: string,
): Promise<number> {
  const points = CLOUT_POINTS.redemption;
  const { error } = await getServiceClient().from("clout_events").insert({
    user_id: userId,
    source: "redemption",
    points,
    city_id: cityId,
    ref_type: "redemption",
    ref_id: redemptionId,
  });
  if (error) throw new Error(`record clout failed: ${error.message}`);
  return points;
}
