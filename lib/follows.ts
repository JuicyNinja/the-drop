import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * Follows (PRD §9.1, API-CONTRACT §8). Two tiers: Follower (push + in-app,
 * uncapped) and Fanatic (SMS + push, 10 per lane, independent pools). Fanatic is
 * opt-in only — there is NO merchant-initiated path to set a user's tier, and
 * none may be added (grep-verified in the gate).
 *
 * The 10-per-lane cap is enforced by the `enforce_fanatic_cap` DB trigger
 * (counts distinct fanatic orgs in the lane); this module maps the trigger's
 * P0001 to FANATIC_LIMIT_REACHED and returns the current Fanatics in that lane
 * so the client can offer a swap.
 */

export interface FollowRecord {
  org_id: string;
  name: string;
  lane: string;
  tier: string;
}

export async function listFollows(userId: string): Promise<FollowRecord[]> {
  const { data, error } = await getServiceClient()
    .from("follows")
    .select("org_id, lane, tier, organizations!inner(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`list follows failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    org_id: r.org_id as string,
    name: (r.organizations as unknown as { name: string }).name,
    lane: r.lane as string,
    tier: r.tier as string,
  }));
}

async function fanaticsInLane(userId: string, lane: string): Promise<{ org_id: string; name: string }[]> {
  const { data, error } = await getServiceClient()
    .from("follows")
    .select("org_id, organizations!inner(name)")
    .eq("user_id", userId)
    .eq("lane", lane)
    .eq("tier", "fanatic");
  if (error) throw new Error(`fanatics-in-lane load failed: ${error.message}`);
  return (data ?? []).map((r) => ({ org_id: r.org_id as string, name: (r.organizations as unknown as { name: string }).name }));
}

/**
 * Set the caller's follow tier for an org. Upserts the follow row; the lane is
 * taken from the org (independent pools). An 11th Fanatic in a lane trips the
 * cap trigger → FANATIC_LIMIT_REACHED, with the lane's current Fanatics returned
 * for a swap.
 */
export async function setFollowTier(userId: string, orgId: string, tier: "follower" | "fanatic"): Promise<FollowRecord> {
  const svc = getServiceClient();
  const { data: org, error: oErr } = await svc.from("organizations").select("id, name, lane").eq("id", orgId).maybeSingle();
  if (oErr) throw new Error(`load org failed: ${oErr.message}`);
  if (!org) throw new ApiError("NOT_FOUND", "No such organization.");
  const lane = org.lane as string;

  const { error } = await svc
    .from("follows")
    .upsert({ user_id: userId, org_id: orgId, lane, tier }, { onConflict: "user_id,org_id" });
  if (error) {
    if (error.code === "P0001" && /fanatic/i.test(error.message)) {
      throw new ApiError("FANATIC_LIMIT_REACHED", "You already have 10 Fanatics in this lane. Free a slot to add another.", {
        lane,
        current_fanatics: await fanaticsInLane(userId, lane),
      });
    }
    throw new Error(`set follow failed: ${error.message}`);
  }
  return { org_id: orgId, name: org.name as string, lane, tier };
}

export async function unfollow(userId: string, orgId: string): Promise<void> {
  const { error } = await getServiceClient().from("follows").delete().eq("user_id", userId).eq("org_id", orgId);
  if (error) throw new Error(`unfollow failed: ${error.message}`);
}
