import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";
import { getEnv } from "@/lib/env";
import { recordShareClout } from "@/lib/clout";

/**
 * Share links + attribution (PRD §10.4, DATA-MODEL §11.3). The weakest fraud
 * surface in the clout system, so the attribution rules are explicit and
 * enforced server-side:
 *
 *   - Clout is granted ONLY on a verified return click — an authenticated user
 *     returning through the link. A share that is never returned to earns ZERO
 *     (gate item): a raw click at /s/{token} records analytics only, never clout.
 *   - The returner MUST NOT be the sharer (no self-attribution, requirement 1).
 *   - Attribution fires AT MOST ONCE per link, ever (verified_at gate), so repeat
 *     clicks — from the same source or any source — cannot compound (requirement
 *     1). The one grant is claimed with a conditional UPDATE, so concurrent
 *     verifies also resolve to a single winner.
 *
 * Platform-API content verification (TikTok/Instagram) stays deferred; the
 * tracked-link return IS the v1 "verified" signal.
 */

export interface ShareCreated {
  token: string;
  url: string;
}

export async function createShare(userId: string, dropId: string, redemptionId?: string | null): Promise<ShareCreated> {
  const svc = getServiceClient();

  const { data: drop, error: dErr } = await svc.from("drops").select("id").eq("id", dropId).maybeSingle();
  if (dErr) throw new Error(`load drop failed: ${dErr.message}`);
  if (!drop) throw new ApiError("NOT_FOUND", "No such drop.");

  if (redemptionId) {
    const { data: red, error: rErr } = await svc.from("redemptions").select("id, user_id").eq("id", redemptionId).maybeSingle();
    if (rErr) throw new Error(`load redemption failed: ${rErr.message}`);
    if (!red || red.user_id !== userId) throw new ApiError("NOT_FOUND", "No such redemption.");
  }

  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
  const { error } = await svc.from("share_links").insert({
    token,
    user_id: userId,
    drop_id: dropId,
    redemption_id: redemptionId ?? null,
  });
  if (error) throw new Error(`create share failed: ${error.message}`);

  return { token, url: `${getEnv().APP_URL.replace(/\/$/, "")}/s/${token}` };
}

/**
 * Record a raw click at /s/{token} and return where to redirect. Analytics only
 * — a click is NOT verified attribution and grants no clout (a bot, a scraper,
 * or the sharer could produce it). Returns null when the token is unknown.
 */
export async function recordClick(token: string): Promise<{ drop_id: string } | null> {
  const svc = getServiceClient();
  const { data, error } = await svc
    .from("share_links")
    .select("id, drop_id, click_count")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(`load share failed: ${error.message}`);
  if (!data) return null;
  await svc.from("share_links").update({ click_count: (data.click_count as number) + 1 }).eq("id", data.id as string);
  return { drop_id: data.drop_id as string };
}

export interface VerifyResult {
  attributed: boolean;
  reason?: "self" | "already_verified";
  clout_earned?: number;
}

/**
 * A verified return: an authenticated user (`callerId`) came back through the
 * link. Grants the sharer clout once, subject to the two fraud rules.
 */
export async function verifyReturn(callerId: string, token: string): Promise<VerifyResult> {
  const svc = getServiceClient();

  const { data: share, error } = await svc
    .from("share_links")
    .select("id, user_id, drop_id, verified_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error(`load share failed: ${error.message}`);
  if (!share) throw new ApiError("NOT_FOUND", "No such share link.");

  // No self-attribution: the returner cannot be the sharer.
  if (share.user_id === callerId) return { attributed: false, reason: "self" };
  // Already attributed: repeat returns never compound.
  if (share.verified_at !== null) return { attributed: false, reason: "already_verified" };

  // Claim the single grant with a conditional update, so concurrent verifies
  // resolve to exactly one winner.
  const nowIso = new Date().toISOString();
  const { data: won, error: uErr } = await svc
    .from("share_links")
    .update({ verified_at: nowIso })
    .eq("id", share.id as string)
    .is("verified_at", null)
    .select("id");
  if (uErr) throw new Error(`verify share failed: ${uErr.message}`);
  if (!won || won.length === 0) return { attributed: false, reason: "already_verified" };

  // City for the clout leaderboard is the shared drop's city.
  const { data: drop } = await svc.from("drops").select("city_id").eq("id", share.drop_id as string).maybeSingle();
  const cloutEarned = await recordShareClout(share.user_id as string, (drop?.city_id as string | null) ?? null, share.id as string);
  return { attributed: true, clout_earned: cloutEarned };
}
