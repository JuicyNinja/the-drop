import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * Buyer risk profile (WP-14 addition, decided 2026-09-16; recorded in the PRD and
 * BUILD-PLAN). INTERNAL and admin-only — RLS denies every other role. It tracks
 * cost imposed, not virtue.
 *
 * Two rules, both load-bearing:
 *   1. Thresholds FLAG for human review; nothing here suspends. A number that
 *      auto-suspends would suspend the person whose car broke down twice. No code
 *      reads needs_review to act — suspension is only ever a manual admin action.
 *   2. Minimum event counts before a rate means anything. Two abandoned catches
 *      out of three is noise; two out of two hundred is a pattern. Below the
 *      minimum the rate is null and cannot flag — the same reasoning as the
 *      top-1% clout cap being unreachable below 100 users.
 *
 * Derived and recomputable (upsert), not a ledger. Phase 2 (WP-16) fills
 * return_rate / chargeback_count / dispute_loss_count; the columns already exist.
 */

/** A rate needs at least this many catches behind it before it can flag. */
export const MIN_CATCHES_FOR_RATE = 20;
/** Below this redemption rate (with enough catches) is worth a human look. */
export const LOW_REDEMPTION_RATE = 0.5;
/** Above this abandonment rate (with enough catches) is worth a human look. */
export const HIGH_ABANDONMENT_RATE = 0.5;
/** Receiving accepted transfers from at least this many distinct senders flags. */
export const MANY_TRANSFER_SENDERS = 3;

export interface RiskProfile {
  user_id: string;
  catches_total: number;
  redemptions_total: number;
  abandoned_catches: number;
  redemption_rate: number | null;
  transfers_received_total: number;
  distinct_transfer_senders: number;
  whisper_count: number;
  return_rate: number | null;
  chargeback_count: number | null;
  dispute_loss_count: number | null;
  needs_review: boolean;
  review_reasons: string[];
  computed_at: string;
}

interface Agg {
  catches: number; redeemed: number; abandoned: number;
  transfersReceived: number; senders: Set<string>; whispers: number;
}

function emptyAgg(): Agg {
  return { catches: 0, redeemed: 0, abandoned: 0, transfersReceived: 0, senders: new Set(), whispers: 0 };
}

export interface RiskRecomputeResult {
  profiles: number;
  flagged: number;
}

/**
 * Recompute every active buyer's risk profile from catches, transfers, and
 * whispers. Upserts a row for anyone with any activity; a pure lurker gets none.
 */
export async function recomputeBuyerRiskProfiles(now: Date = new Date()): Promise<RiskRecomputeResult> {
  const svc = getServiceClient();
  const agg = new Map<string, Agg>();
  const get = (id: string): Agg => {
    let a = agg.get(id);
    if (!a) { a = emptyAgg(); agg.set(id, a); }
    return a;
  };

  // Catches keyed on the ORIGINAL catcher — the account that imposed the cost,
  // regardless of who currently holds the catch.
  const { data: catches, error: cErr } = await svc.from("catches").select("original_user_id, status").limit(100000);
  if (cErr) throw new Error(`risk: catches read failed: ${cErr.message}`);
  for (const c of catches ?? []) {
    const a = get(c.original_user_id as string);
    a.catches += 1;
    if (c.status === "redeemed") a.redeemed += 1;
    if (c.status === "expired") a.abandoned += 1; // caught, window closed unredeemed
  }

  // Accepted transfers received: total and distinct senders.
  const { data: transfers, error: tErr } = await svc.from("transfers").select("to_user_id, from_user_id").eq("status", "accepted").limit(100000);
  if (tErr) throw new Error(`risk: transfers read failed: ${tErr.message}`);
  for (const t of transfers ?? []) {
    const a = get(t.to_user_id as string);
    a.transfersReceived += 1;
    a.senders.add(t.from_user_id as string);
  }

  // Whispers — a low-weight positive signal (engaged buyer). Never raises a flag.
  const { data: whispers, error: wErr } = await svc.from("whispers").select("user_id").limit(100000);
  if (wErr) throw new Error(`risk: whispers read failed: ${wErr.message}`);
  for (const w of whispers ?? []) get(w.user_id as string).whispers += 1;

  const rows: Record<string, unknown>[] = [];
  let flagged = 0;
  const computedAt = now.toISOString();

  for (const [userId, a] of agg) {
    const enoughCatches = a.catches >= MIN_CATCHES_FOR_RATE;
    const redemptionRate = enoughCatches ? Number((a.redeemed / a.catches).toFixed(4)) : null;
    const abandonmentRate = enoughCatches ? a.abandoned / a.catches : null;

    const reasons: string[] = [];
    if (redemptionRate !== null && redemptionRate < LOW_REDEMPTION_RATE) reasons.push("low_redemption_rate");
    if (abandonmentRate !== null && abandonmentRate > HIGH_ABANDONMENT_RATE) reasons.push("high_abandonment");
    if (a.senders.size >= MANY_TRANSFER_SENDERS) reasons.push("many_transfer_senders");

    const needsReview = reasons.length > 0;
    if (needsReview) flagged += 1;

    rows.push({
      user_id: userId,
      catches_total: a.catches,
      redemptions_total: a.redeemed,
      abandoned_catches: a.abandoned,
      redemption_rate: redemptionRate,
      transfers_received_total: a.transfersReceived,
      distinct_transfer_senders: a.senders.size,
      whisper_count: a.whispers,
      needs_review: needsReview,
      review_reasons: reasons,
      computed_at: computedAt,
    });
  }

  if (rows.length > 0) {
    const { error: upErr } = await svc.from("buyer_risk_profiles").upsert(rows, { onConflict: "user_id" });
    if (upErr) throw new Error(`risk upsert failed: ${upErr.message}`);
  }
  return { profiles: rows.length, flagged };
}

const RISK_COLUMNS =
  "user_id, catches_total, redemptions_total, abandoned_catches, redemption_rate, transfers_received_total, distinct_transfer_senders, whisper_count, return_rate, chargeback_count, dispute_loss_count, needs_review, review_reasons, computed_at";

/** One buyer's risk profile. Admin-only at the route; RLS is the second wall. */
export async function getRiskProfile(userId: string): Promise<RiskProfile> {
  const { data, error } = await getServiceClient().from("buyer_risk_profiles").select(RISK_COLUMNS).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`load risk profile failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No risk profile for this user yet.");
  return data as RiskProfile;
}

/** Buyers currently flagged for review, worst first. */
export async function listFlaggedRiskProfiles(limit = 100): Promise<RiskProfile[]> {
  const { data, error } = await getServiceClient()
    .from("buyer_risk_profiles").select(RISK_COLUMNS)
    .eq("needs_review", true)
    .order("distinct_transfer_senders", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`list flagged risk profiles failed: ${error.message}`);
  return (data ?? []) as RiskProfile[];
}
