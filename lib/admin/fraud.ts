import { getServiceClient } from "@/lib/supabase/server";

/**
 * Fraud review (API-CONTRACT §11). All read-only — review surfaces, not actions.
 * Nothing here suspends anyone; an admin reads these and decides. The one control
 * that acts automatically is the WP-8 unverified rate limit (5 per 30 days); these
 * views make the accounts near or over that line, and unusual transfer shapes,
 * visible for a human.
 */

/** Trailing-30-day unverified auto-redemptions at or above this count are a
 *  velocity flag — approaching the 5/30 rate limit unusually fast. */
export const VELOCITY_UNVERIFIED_30D = 4;

/** Receiving accepted transfers from at least this many distinct senders is a
 *  transfer-pattern flag: one account collecting catches from many others. */
export const MANY_SENDERS = 3;

const DAY_MS = 86_400_000;

export interface UnverifiedRedemption {
  redemption_id: string;
  user_handle: string;
  user_id: string;
  drop_title: string;
  redeemed_at: string;
}

/** Recent unverified (no-fix timeout) redemptions, newest first. */
export async function listUnverifiedRedemptions(limit = 100): Promise<UnverifiedRedemption[]> {
  const { data, error } = await getServiceClient()
    .from("redemptions")
    .select("id, user_id, redeemed_at, users(handle), drops(title)")
    .eq("method", "unverified_timeout")
    .order("redeemed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`unverified redemptions failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    redemption_id: r.id as string,
    user_id: r.user_id as string,
    user_handle: (r.users as unknown as { handle: string } | null)?.handle ?? "",
    drop_title: (r.drops as unknown as { title: string } | null)?.title ?? "",
    redeemed_at: r.redeemed_at as string,
  }));
}

export interface VelocityFlag {
  user_id: string;
  user_handle: string;
  unverified_30d: number;
  limit: number;
}

/**
 * Accounts whose unverified auto-redemptions in the trailing 30 days are at or
 * above the velocity threshold. This is the abuse vector the rate limit guards;
 * the flag surfaces it before the limit is hit repeatedly.
 */
export async function listVelocityFlags(now: Date = new Date()): Promise<VelocityFlag[]> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const { data, error } = await getServiceClient()
    .from("redemptions")
    .select("user_id, users(handle)")
    .eq("method", "unverified_timeout")
    .gte("redeemed_at", since);
  if (error) throw new Error(`velocity flags failed: ${error.message}`);

  const byUser = new Map<string, { handle: string; count: number }>();
  for (const r of data ?? []) {
    const uid = r.user_id as string;
    const handle = (r.users as unknown as { handle: string } | null)?.handle ?? "";
    const cur = byUser.get(uid) ?? { handle, count: 0 };
    cur.count += 1;
    byUser.set(uid, cur);
  }
  return [...byUser.entries()]
    .filter(([, v]) => v.count >= VELOCITY_UNVERIFIED_30D)
    .map(([user_id, v]) => ({ user_id, user_handle: v.handle, unverified_30d: v.count, limit: 5 }))
    .sort((a, b) => b.unverified_30d - a.unverified_30d);
}

export interface TransferPattern {
  user_id: string;
  user_handle: string;
  distinct_senders: number;
  transfers_received: number;
}

/**
 * One account receiving from many senders (gate item 3). Aggregates ACCEPTED
 * transfers by recipient and surfaces those whose distinct-sender count is at or
 * above the threshold — the shape of catch-collection across unrelated accounts.
 */
export async function listTransferPatterns(): Promise<TransferPattern[]> {
  const { data, error } = await getServiceClient()
    .from("transfers")
    .select("to_user_id, from_user_id, users:to_user_id(handle)")
    .eq("status", "accepted")
    .limit(5000);
  if (error) throw new Error(`transfer patterns failed: ${error.message}`);

  const byRecipient = new Map<string, { handle: string; senders: Set<string>; total: number }>();
  for (const t of data ?? []) {
    const to = t.to_user_id as string;
    const from = t.from_user_id as string;
    const handle = (t.users as unknown as { handle: string } | null)?.handle ?? "";
    const cur = byRecipient.get(to) ?? { handle, senders: new Set<string>(), total: 0 };
    cur.senders.add(from);
    cur.total += 1;
    byRecipient.set(to, cur);
  }
  return [...byRecipient.entries()]
    .map(([user_id, v]) => ({ user_id, user_handle: v.handle, distinct_senders: v.senders.size, transfers_received: v.total }))
    .filter((r) => r.distinct_senders >= MANY_SENDERS)
    .sort((a, b) => b.distinct_senders - a.distinct_senders);
}
