import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import {
  claimIdempotencyKey,
  getIdempotencyResult,
  storeIdempotencyResult,
} from "@/lib/redis";
import { getServiceClient } from "@/lib/supabase/server";
import { distanceMiles } from "@/lib/geo/distance";
import { recordRedemptionClout } from "@/lib/clout";

/**
 * REDEMPTION (PRD §7, API-CONTRACT §6). The buyer types the drop's code into
 * their OWN device; the operator never enters anything (invariant #8). GPS
 * governs redemption — the buyer's saved/active address is never consulted.
 *
 * The two GPS failures are DIFFERENT and must stay different:
 *   - permission_denied → BLOCKED (LOCATION_PERMISSION_REQUIRED). If this
 *     routed to the timeout path, turning off location would be a one-tap
 *     redeem-from-anywhere bypass. This is the bypass test.
 *   - no_fix_timeout    → AUTO-REDEEM, flagged unverified_timeout, rate-limited
 *     5 per rolling 30 days per user (server-side; the client cannot reset it).
 */

const ACCURACY_FLOOR_M = 100; // readings worse than this are rejected (PRD §7.4)
const METERS_PER_MILE = 1609.344;
const UNVERIFIED_LIMIT = 5; // per rolling 30 days
const VELOCITY_IMPOSSIBLE_MPH = 500; // implied travel speed that flags fraud

export type GpsStatus = "fix_acquired" | "permission_denied" | "no_fix_timeout";

export interface RedeemInput {
  catch_id: string;
  code: string;
  location?: { lat: number; lng: number; accuracy_m: number } | null;
  gps_status: GpsStatus;
}

/** Buyer-facing success. NOTE: no `method` field — the unverified flag must
 *  never appear in a buyer-facing response (PRD §7.5). */
export interface RedeemSuccess {
  kind: "ok";
  redemption_id: string;
  redeemed: true;
  clout_earned: number;
  whisper_prompt: true;
}
interface RedeemFailure {
  kind: "error";
  code: string;
  message: string;
}
type StoredRedeem = RedeemSuccess | RedeemFailure;

function replay(stored: StoredRedeem): RedeemSuccess {
  if (stored.kind === "ok") return stored;
  throw new ApiError(stored.code as never, stored.message);
}

async function unverifiedCountLast30Days(userId: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await getServiceClient()
    .from("redemptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("method", "unverified_timeout")
    .gte("redeemed_at", since);
  if (error) throw new Error(`rate-limit count failed: ${error.message}`);
  return count ?? 0;
}

/** Impossible-travel flag: distance from the user's last redemption over the
 *  elapsed time. Uses the MERCHANT location coords (where they physically
 *  redeemed), so it works for timeout redemptions with no fix too. */
async function velocityFlag(
  userId: string,
  here: { lat: number; lng: number },
  now: Date,
): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from("redemptions")
    .select("redeemed_at, locations!inner(lat, lng)")
    .eq("user_id", userId)
    .order("redeemed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`velocity lookup failed: ${error.message}`);
  if (!data) return false;
  const prior = data.locations as unknown as { lat: number; lng: number };
  const hours = (now.getTime() - new Date(data.redeemed_at as string).getTime()) / 3_600_000;
  if (hours <= 0) return true;
  const miles = distanceMiles(here, { lat: prior.lat, lng: prior.lng });
  return miles / hours > VELOCITY_IMPOSSIBLE_MPH;
}

export async function redeem(
  userId: string,
  input: RedeemInput,
  idempotencyKey: string,
): Promise<RedeemSuccess> {
  const svc = getServiceClient();

  // Idempotency: a retried redemption returns the original result and never
  // writes a second redemption or clout row.
  const claimed = await claimIdempotencyKey(idempotencyKey);
  if (!claimed) {
    for (let i = 0; i < 100; i++) {
      const prior = await getIdempotencyResult<StoredRedeem>(idempotencyKey);
      if (prior && prior !== "pending") return replay(prior);
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new ApiError("RATE_LIMITED", "A redemption for this key is still in progress.");
  }

  const fail = async (code: string, message: string, details?: Record<string, unknown>): Promise<never> => {
    await storeIdempotencyResult(idempotencyKey, { kind: "error", code, message });
    throw new ApiError(code as never, message, details);
  };

  // Load the catch, its drop (for the code), and the drop's location (geofence).
  const { data: catchRow, error: cErr } = await svc
    .from("catches")
    .select("id, user_id, status, expires_at, drop_id")
    .eq("id", input.catch_id)
    .maybeSingle();
  if (cErr) throw new Error(`load catch failed: ${cErr.message}`);
  // Do not reveal whether the catch exists or belongs to someone else.
  if (!catchRow || catchRow.user_id !== userId) return fail("INVALID_CODE", "That code is not valid.");

  const { data: drop, error: dErr } = await svc
    .from("drops")
    .select("id, code, location_id")
    .eq("id", catchRow.drop_id)
    .maybeSingle();
  if (dErr) throw new Error(`load drop failed: ${dErr.message}`);
  if (!drop || !drop.code || input.code.toUpperCase() !== drop.code) {
    return fail("INVALID_CODE", "That code is not valid.");
  }

  if (catchRow.status === "redeemed") return fail("ALREADY_REDEEMED", "This catch has already been redeemed.");
  if (new Date(catchRow.expires_at as string) <= new Date()) return fail("REDEMPTION_WINDOW_CLOSED", "The redemption window has closed.");
  if (catchRow.status !== "held") return fail("INVALID_CODE", "That code is not valid.");

  const { data: loc, error: lErr } = await svc
    .from("locations")
    .select("id, lat, lng, geofence_radius_m, city_id")
    .eq("id", drop.location_id)
    .maybeSingle();
  if (lErr) throw new Error(`load location failed: ${lErr.message}`);
  if (!loc) throw new Error("drop location missing");

  // --- the two-path GPS model ---
  let method: "gps_verified" | "unverified_timeout";
  let distanceM: number | null = null;
  let lat: number | null = null;
  let lng: number | null = null;
  let accuracyM: number | null = null;

  if (input.gps_status === "permission_denied") {
    // BLOCKED. Never redeems. (bypass test)
    return fail("LOCATION_PERMISSION_REQUIRED", "Location permission is required to redeem.");
  } else if (input.gps_status === "fix_acquired") {
    if (!input.location) return fail("VALIDATION_ERROR", "A GPS fix is required for fix_acquired.");
    if (input.location.accuracy_m > ACCURACY_FLOOR_M) {
      return fail("GPS_ACCURACY_INSUFFICIENT", "GPS accuracy is too low; try again.");
    }
    const miles = distanceMiles(input.location, { lat: loc.lat as number, lng: loc.lng as number });
    distanceM = Math.round(miles * METERS_PER_MILE);
    if (distanceM > (loc.geofence_radius_m as number)) {
      return fail("OUTSIDE_GEOFENCE", "You are outside the redemption area.");
    }
    method = "gps_verified";
    lat = input.location.lat;
    lng = input.location.lng;
    accuracyM = input.location.accuracy_m;
  } else {
    // no_fix_timeout: auto-redeem, rate-limited server-side (rolling 30 days).
    if ((await unverifiedCountLast30Days(userId)) >= UNVERIFIED_LIMIT) {
      return fail("RATE_LIMITED", "Too many unverified redemptions in the last 30 days.");
    }
    method = "unverified_timeout";
  }

  const now = new Date();
  const flagged = await velocityFlag(userId, { lat: loc.lat as number, lng: loc.lng as number }, now);

  const redemptionId = randomUUID();
  const { error: rErr } = await svc.from("redemptions").insert({
    id: redemptionId,
    catch_id: input.catch_id,
    drop_id: drop.id,
    location_id: loc.id,
    user_id: userId,
    method,
    lat,
    lng,
    accuracy_m: accuracyM,
    distance_m: distanceM,
    velocity_flagged: flagged,
    redeemed_at: now.toISOString(),
  });
  if (rErr) {
    if (rErr.code === "23505") return fail("ALREADY_REDEEMED", "This catch has already been redeemed.");
    throw new Error(`redemption insert failed: ${rErr.message}`);
  }

  await svc.from("catches").update({ status: "redeemed" }).eq("id", input.catch_id);

  // Clout: the redemption source event. City from the merchant location.
  const cloutEarned = await recordRedemptionClout(userId, (loc.city_id as string | null) ?? null, redemptionId);

  const success: RedeemSuccess = {
    kind: "ok",
    redemption_id: redemptionId,
    redeemed: true,
    clout_earned: cloutEarned,
    whisper_prompt: true,
  };
  await storeIdempotencyResult(idempotencyKey, success);
  return success;
}
