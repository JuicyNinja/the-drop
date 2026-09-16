import { getServiceClient } from "@/lib/supabase/server";

/**
 * Clout: the earned-status system (PRD §10.4, DATA-MODEL §11).
 *
 * TWO doctrines this file must never break:
 *   1. Clout is written from EXACTLY three sources — completed redemption,
 *      whisper, attributed share — and there is NO admin grant and NO purchase
 *      path (invariant #6). Every writer here is one of those three; nothing
 *      takes an amount or a reason from a caller.
 *   2. `clout_events` is an append-only ledger. Scores are DERIVED from it, never
 *      the other way round. The hourly recompute reads the ledger and rewrites
 *      the materialized `clout_scores`; it never mutates an event.
 *
 * Because scores are a pure function of (ledger, reference hour), the recompute
 * is deterministic and idempotent: running it twice in the same hour produces
 * identical scores and never compounds the decay (requirement 3).
 */

/** Points per source. One place to tune. Never taken from a caller. */
export const CLOUT_POINTS = {
  /** A completed redemption. Unverified (timeout) redemptions earn this too —
   *  the rate limit is the fraud control (WP-8 decision). */
  redemption: 10,
  /** Submitting a post-redemption whisper. One per redemption. */
  whisper: 5,
  /** A share link that produced a verified return click by someone other than
   *  the sharer. Granted once per link, ever (WP-10). */
  attributed_share: 15,
} as const;

// --- Decay + tier model (WP-10 decisions; recorded in the BUILD-PLAN). --------

/** Exponential half-life. A clout event is worth half its points after this
 *  many days. Deterministic and continuous — no step function to game. */
export const CLOUT_HALF_LIFE_DAYS = 30;

/** Tier 5 is a HARD-CAPPED leaderboard, not a percentile band: the top
 *  `floor(activeUsers * 0.01)` users in the city. So tier-5 population can never
 *  exceed 1% (gate item), and below 100 active users the floor is 0 → tier 5 is
 *  UNREACHABLE rather than rounded up to a single permanent holder (requirement
 *  2). Tiers 1–4 are percentile bands (percentile = rank/N, rank 1 = best). */
export const TIER5_CAP_FRACTION = 0.01;
export const TIER_BANDS = { t4: 0.1, t3: 0.3, t2: 0.6 } as const; // percentile ceilings

async function recordClout(
  userId: string,
  source: "redemption" | "whisper" | "attributed_share",
  cityId: string | null,
  refType: string,
  refId: string,
): Promise<number> {
  const points = CLOUT_POINTS[source];
  const { error } = await getServiceClient().from("clout_events").insert({
    user_id: userId,
    source,
    points,
    city_id: cityId,
    ref_type: refType,
    ref_id: refId,
  });
  if (error) throw new Error(`record clout (${source}) failed: ${error.message}`);
  return points;
}

/** Redemption source event. City is the MERCHANT location's city (clout is
 *  capped per city; the buyer's city would let a thin market be farmed). */
export async function recordRedemptionClout(userId: string, cityId: string | null, redemptionId: string): Promise<number> {
  return recordClout(userId, "redemption", cityId, "redemption", redemptionId);
}

/** Whisper source event. */
export async function recordWhisperClout(userId: string, cityId: string | null, whisperId: string): Promise<number> {
  return recordClout(userId, "whisper", cityId, "whisper", whisperId);
}

/** Attributed-share source event (a verified return click). */
export async function recordShareClout(userId: string, cityId: string | null, shareId: string): Promise<number> {
  return recordClout(userId, "attributed_share", cityId, "share", shareId);
}

// --- Recompute ---------------------------------------------------------------

export interface CloutRecomputeResult {
  reference_hour: string;
  cities: number;
  users: number;
  /** tier-5 population per city, for the cap assertion. */
  tier5_by_city: Record<string, { active_users: number; tier5: number }>;
  /**
   * Clout events that joined NO city leaderboard this run (unresolvable to a
   * city). The expected value is 0 — locations now carry a NOT-NULL city — so
   * anything above 0 is a bug report that finds itself, and belongs on the admin
   * metrics surface. Never a silent drop.
   */
  skipped_no_city: number;
}

/**
 * Resolve the CURRENT city for clout events that were written without one
 * (city_id null). The city is derived from the event's live source record —
 * redemption/whisper → location → city, share → drop → city — NOT from a frozen
 * value, so an event whose location had no city when it was written joins the
 * leaderboard on the next recompute once the city is set (retroactive, never
 * permanently orphaned). Events written WITH a city keep it (authoritative
 * snapshot). Returns a ref_id → city_id map for the null-city events.
 */
async function resolveMissingCities(
  events: { city_id: string | null; ref_type: string | null; ref_id: string | null }[],
): Promise<Map<string, string>> {
  const svc = getServiceClient();
  const idsByType = { redemption: new Set<string>(), whisper: new Set<string>(), share: new Set<string>() };
  for (const e of events) {
    if (e.city_id !== null || !e.ref_id) continue;
    if (e.ref_type === "redemption") idsByType.redemption.add(e.ref_id);
    else if (e.ref_type === "whisper") idsByType.whisper.add(e.ref_id);
    else if (e.ref_type === "share") idsByType.share.add(e.ref_id);
  }
  const out = new Map<string, string>();
  const locCity = new Map<string, string | null>();

  async function cityForLocations(locIds: string[]): Promise<void> {
    const missing = locIds.filter((id) => !locCity.has(id));
    if (missing.length === 0) return;
    const { data } = await svc.from("locations").select("id, city_id").in("id", missing);
    for (const r of data ?? []) locCity.set(r.id as string, (r.city_id as string | null) ?? null);
  }

  if (idsByType.redemption.size > 0) {
    const { data } = await svc.from("redemptions").select("id, location_id").in("id", [...idsByType.redemption]);
    await cityForLocations((data ?? []).map((r) => r.location_id as string));
    for (const r of data ?? []) { const c = locCity.get(r.location_id as string); if (c) out.set(r.id as string, c); }
  }
  if (idsByType.whisper.size > 0) {
    const { data } = await svc.from("whispers").select("id, location_id").in("id", [...idsByType.whisper]);
    await cityForLocations((data ?? []).map((r) => r.location_id as string));
    for (const r of data ?? []) { const c = locCity.get(r.location_id as string); if (c) out.set(r.id as string, c); }
  }
  if (idsByType.share.size > 0) {
    const { data } = await svc.from("share_links").select("id, drop_id").in("id", [...idsByType.share]);
    const dropIds = (data ?? []).map((r) => r.drop_id as string);
    const dropCity = new Map<string, string | null>();
    if (dropIds.length > 0) {
      const { data: drops } = await svc.from("drops").select("id, city_id").in("id", dropIds);
      for (const d of drops ?? []) dropCity.set(d.id as string, (d.city_id as string | null) ?? null);
    }
    for (const r of data ?? []) { const c = dropCity.get(r.drop_id as string); if (c) out.set(r.id as string, c); }
  }
  return out;
}

/** The top of the current hour — the deterministic reference for decay so two
 *  runs inside the same hour produce identical scores. */
export function referenceHour(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
}

function decayFactor(occurredAt: Date, ref: Date): number {
  const ageDays = Math.max(0, (ref.getTime() - occurredAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / CLOUT_HALF_LIFE_DAYS);
}

/**
 * Recompute clout_scores for every city from the ledger. Pure function of the
 * events and the reference hour, so it is deterministic and idempotent.
 *
 * Per city: sum each user's decayed points, rank by decayed_score (ties broken
 * by user_id for stability), assign tier 5 to the top floor(N*0.01) and tiers
 * 1–4 by percentile band, then UPSERT. N (the city's "active users") is the set
 * of users with any clout event in that city.
 */
export async function recomputeAllClout(now: Date = new Date()): Promise<CloutRecomputeResult> {
  const svc = getServiceClient();
  const ref = referenceHour(now);

  // Read the ledger (append-only) — ALL events, including any without a stored
  // city, so none is dropped silently.
  const { data: events, error } = await svc
    .from("clout_events")
    .select("user_id, points, occurred_at, city_id, ref_type, ref_id");
  if (error) throw new Error(`clout recompute read failed: ${error.message}`);

  // Resolve the current city for events written without one (retroactive join).
  const resolved = await resolveMissingCities(events ?? []);

  // Clout freeze (WP-14): a frozen user stops accruing from the freeze instant.
  // Events on/after clout_frozen_at are ignored here — the ledger is never
  // mutated (invariant #6), decay still applies to what accrued before, and
  // lifting the freeze (null) restores full accrual on the next recompute.
  const { data: frozenUsers } = await svc
    .from("users")
    .select("id, clout_frozen_at")
    .not("clout_frozen_at", "is", null);
  const frozenAt = new Map<string, number>();
  for (const f of frozenUsers ?? []) {
    frozenAt.set(f.id as string, new Date(f.clout_frozen_at as string).getTime());
  }

  // city -> user -> { raw, decayed }
  const byCity = new Map<string, Map<string, { raw: number; decayed: number }>>();
  let skippedNoCity = 0;
  for (const e of events ?? []) {
    // Stored city is the authoritative snapshot; a null one resolves from the
    // live source. An event that maps to no city joins nothing — and is counted,
    // never silently dropped.
    const cityId = (e.city_id as string | null) ?? resolved.get(e.ref_id as string) ?? null;
    if (cityId === null) { skippedNoCity++; continue; }
    const userId = e.user_id as string;
    const fa = frozenAt.get(userId);
    if (fa !== undefined && new Date(e.occurred_at as string).getTime() >= fa) continue; // frozen: no accrual past the freeze
    const points = e.points as number;
    const decayed = points * decayFactor(new Date(e.occurred_at as string), ref);
    let users = byCity.get(cityId);
    if (!users) { users = new Map(); byCity.set(cityId, users); }
    const cur = users.get(userId) ?? { raw: 0, decayed: 0 };
    cur.raw += points;
    cur.decayed += decayed;
    users.set(userId, cur);
  }
  if (skippedNoCity > 0) {
    console.warn(`[clout] ${skippedNoCity} clout event(s) joined no city leaderboard (unresolvable city). Expected 0.`);
  }

  const rows: {
    user_id: string; city_id: string; raw_score: number; decayed_score: number;
    percentile: number; tier: number; computed_at: string;
  }[] = [];
  const tier5ByCity: Record<string, { active_users: number; tier5: number }> = {};
  let userCount = 0;

  for (const [cityId, users] of byCity) {
    const ranked = [...users.entries()]
      .map(([userId, s]) => ({ userId, raw: s.raw, decayed: s.decayed }))
      // decayed desc, then user_id asc — a total order, so ranks are stable.
      .sort((a, b) => (b.decayed - a.decayed) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
    const n = ranked.length;
    const tier5Slots = Math.floor(n * TIER5_CAP_FRACTION);
    let tier5 = 0;

    ranked.forEach((u, i) => {
      const rank = i + 1; // 1 = best
      const percentile = rank / n; // smaller = higher standing
      let tier: number;
      if (rank <= tier5Slots) { tier = 5; tier5++; }
      else if (percentile <= TIER_BANDS.t4) tier = 4;
      else if (percentile <= TIER_BANDS.t3) tier = 3;
      else if (percentile <= TIER_BANDS.t2) tier = 2;
      else tier = 1;
      rows.push({
        user_id: u.userId,
        city_id: cityId,
        raw_score: Number(u.raw.toFixed(4)),
        decayed_score: Number(u.decayed.toFixed(4)),
        percentile: Number(percentile.toFixed(4)),
        tier,
        computed_at: now.toISOString(),
      });
    });
    tier5ByCity[cityId] = { active_users: n, tier5 };
    userCount += n;
  }

  // UPSERT on the (user_id, city_id) PK. Idempotent: same ledger + same
  // reference hour → identical scores overwrite identical scores.
  if (rows.length > 0) {
    const { error: upErr } = await svc.from("clout_scores").upsert(rows, { onConflict: "user_id,city_id" });
    if (upErr) throw new Error(`clout recompute upsert failed: ${upErr.message}`);
  }

  return {
    reference_hour: ref.toISOString(),
    cities: byCity.size,
    users: userCount,
    tier5_by_city: tier5ByCity,
    skipped_no_city: skippedNoCity,
  };
}

// --- Read (GET /v1/users/me/clout) -------------------------------------------

export interface CloutView {
  city_id: string | null;
  tier: number;
  percentile: number | null;
  decayed_score: number;
  recent_events: { source: string; points: number; occurred_at: string }[];
}

/**
 * The caller's clout for their strongest city (highest decayed_score), plus
 * their most recent ledger events. A user with no clout reads as tier 1, score
 * 0 — never an error.
 */
export async function getCloutView(userId: string): Promise<CloutView> {
  const svc = getServiceClient();
  const { data: scores, error } = await svc
    .from("clout_scores")
    .select("city_id, tier, percentile, decayed_score")
    .eq("user_id", userId)
    .order("decayed_score", { ascending: false })
    .limit(1);
  if (error) throw new Error(`clout read failed: ${error.message}`);

  const { data: recent, error: rErr } = await svc
    .from("clout_events")
    .select("source, points, occurred_at")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(5);
  if (rErr) throw new Error(`clout events read failed: ${rErr.message}`);

  const top = scores?.[0];
  return {
    city_id: (top?.city_id as string | undefined) ?? null,
    tier: (top?.tier as number | undefined) ?? 1,
    percentile: (top?.percentile as number | undefined) ?? null,
    decayed_score: Number(top?.decayed_score ?? 0),
    recent_events: (recent ?? []).map((e) => ({
      source: e.source as string,
      points: e.points as number,
      occurred_at: e.occurred_at as string,
    })),
  };
}
