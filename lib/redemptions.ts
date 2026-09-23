import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import {
  claimIdempotencyKey,
  getIdempotencyResult,
  storeIdempotencyResult,
} from "@/lib/redis";
import { getServiceClient } from "@/lib/supabase/server";
import { distanceMiles } from "@/lib/geo/distance";
import { isDailyWindowOpen, nextDailyOpen, formatRedeemWindow, type RedeemWindow } from "@/lib/window";
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
    .select("id, code, location_id, redeem_from, redeem_until, redeem_days, redeem_time_start, redeem_time_end")
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

  // Recurring daily window (PRD §4.4): a redemption must fall inside the drop's
  // daily window, evaluated in the location's city timezone. The final close /
  // catch expiry (redeem_until) is checked above; this is the per-day gate. A
  // continuous window (null redeem_days) is always open here. Checked BEFORE the
  // GPS branch so a closed window fails fast, and returns the next opening so the
  // buyer knows when to come back.
  const { data: cityRow, error: czErr } = await svc.from("cities").select("timezone").eq("id", loc.city_id).maybeSingle();
  if (czErr) throw new Error(`load city timezone failed: ${czErr.message}`);
  const tz = (cityRow?.timezone as string | null) ?? "America/Denver";
  const win: RedeemWindow = {
    redeem_from: (drop.redeem_from as string | null) ?? null, redeem_until: (drop.redeem_until as string | null) ?? null,
    redeem_days: (drop.redeem_days as number[] | null) ?? null,
    redeem_time_start: (drop.redeem_time_start as string | null) ?? null, redeem_time_end: (drop.redeem_time_end as string | null) ?? null,
  };
  if (!isDailyWindowOpen(win, tz)) {
    const next = nextDailyOpen(win, tz);
    return fail("REDEMPTION_WINDOW_CLOSED", "This offer isn't open for redemption right now.", {
      window: formatRedeemWindow(win, tz),
      next_open_at: next ? next.toISOString() : null,
    });
  }

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

  // Acquire the catch as the mutual-exclusion lock (WP-9): flip held → redeemed
  // conditionally. This serializes against a concurrent transfer send, which
  // flips held → transfer_pending under the same WHERE status='held' guard, so
  // exactly one of {redeem, send} wins a given catch. A redemption can never
  // proceed on a catch with a transfer pending, and a send can never proceed on
  // a catch mid-redemption. (Requirement: transfer and redemption are mutually
  // exclusive, both directions.) The load-time status check above is the fast
  // path; this is the authoritative lock against the race.
  const { data: acquired, error: aErr } = await svc
    .from("catches")
    .update({ status: "redeemed" })
    .eq("id", input.catch_id)
    .eq("status", "held")
    .select("id");
  if (aErr) throw new Error(`acquire catch failed: ${aErr.message}`);
  if (!acquired || acquired.length === 0) {
    // Lost the race: the catch was moved (redeemed already, or transfer_pending)
    // between the load and here. Re-read to report precisely without leaking.
    const { data: fresh, error: freshErr } = await svc.from("catches").select("status").eq("id", input.catch_id).maybeSingle();
    if (freshErr) throw new Error(`re-read catch failed: ${freshErr.message}`);
    if ((fresh?.status as string | undefined) === "redeemed") {
      return fail("ALREADY_REDEEMED", "This catch has already been redeemed.");
    }
    return fail("INVALID_CODE", "That code is not valid.");
  }

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
    // Backstop for the unique(catch_id) index; unreachable in the normal flow
    // now that the conditional flip above already claimed the catch.
    if (rErr.code === "23505") return fail("ALREADY_REDEEMED", "This catch has already been redeemed.");
    // Genuine write failure after we flipped the catch: roll it back to held so
    // it is not stranded as redeemed with no redemption row.
    const { error: rbErr } = await svc.from("catches").update({ status: "held" }).eq("id", input.catch_id).eq("status", "redeemed");
    if (rbErr) throw new Error(`redemption insert failed: ${rErr.message}; rollback to held also failed (catch stranded redeemed): ${rbErr.message}`);
    throw new Error(`redemption insert failed: ${rErr.message}`);
  }

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
