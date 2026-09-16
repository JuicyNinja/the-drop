import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";
import { distanceMiles } from "@/lib/geo/distance";
import { resolveCityId } from "@/lib/cities";
import { leafIdsForFilter } from "@/lib/tags";

/**
 * The board and ranking (PRD §10.2/§10.3, API-CONTRACT §4).
 *
 * THE ranking metric is `pct_remaining` ASCENDING — lower remaining is hotter —
 * a PERCENTAGE, never an absolute count, so a 10-unit and a 200-unit drop at
 * equal sell-through rank equally. Merchant redemption rate is displayed but is
 * NEVER a ranking input.
 *
 * Tie-break at equal pct_remaining (WP-11 decision, recorded in the build plan):
 * RECENCY — most-recently-live first. At the top of an hour every live drop is
 * pct_remaining 1.0, so without a deliberate tie-break On Fire would be whatever
 * order the database returned. Recency is size-neutral; catch velocity / count
 * were rejected because they favour the larger drop and would reintroduce the
 * exact count bias the percentage metric exists to remove.
 */

const LANES = ["local", "maker", "digital"] as const;
const PER_LANE = 20;
const DAY_MS = 86_400_000;

export interface DropCard {
  id: string;
  lane: string;
  title: string;
  image_url: string | null;
  quantity_total: number;
  quantity_remaining: number;
  pct_remaining: number;
  price_cents: number | null;
  live_until: string | null;
  redeem_until: string | null;
  status: string;
  merchant: { org_id: string; name: string; redemption_rate: number | null };
}

export interface BoardResult {
  data: Record<string, { on_fire: DropCard[]; new: DropCard[]; gone: DropCard[] }>;
  meta: { city_id: string | null; cold_start: boolean; ranking: string };
}

/** A drop leaves the board this long after it goes Gone (DESIGN-SYSTEM §4.9). */
const GONE_BOARD_MS = 5 * 60 * 1000;

interface LiveDropRow {
  id: string; lane: string; title: string; image_urls: string[] | null;
  quantity_total: number; quantity_remaining: number; price_cents: number | null;
  live_at: string | null; live_until: string | null; redeem_until: string | null;
  status: string; org_id: string; location_lat: number | null; location_lng: number | null;
  pct: number;
}

/** pct_remaining, preferring the materialized drop_pressure value, falling back
 *  to the live quantity (a drop that went live since the last recompute). */
function pctOf(qt: number, qr: number, pressure: number | null): number {
  if (pressure !== null && pressure !== undefined) return Number(pressure);
  return qt > 0 ? qr / qt : 0;
}

// ---------------------------------------------------------------------------
// Pressure recompute (60s job). pct_remaining ranks the board; recomputed from
// the reconciled quantity_remaining (which tracks Redis). Never a ranking input
// beyond pct_remaining.
// ---------------------------------------------------------------------------
export async function recomputeAllPressure(now: Date = new Date()): Promise<{ drops: number }> {
  const svc = getServiceClient();
  const { data, error } = await svc.from("drops").select("id, quantity_total, quantity_remaining").eq("status", "live");
  if (error) throw new Error(`pressure recompute read failed: ${error.message}`);
  const rows = (data ?? []).map((d) => {
    const qt = d.quantity_total as number;
    const qr = d.quantity_remaining as number;
    return {
      drop_id: d.id as string,
      views: 0,
      catches: Math.max(0, qt - qr),
      pct_remaining: Number((qt > 0 ? qr / qt : 0).toFixed(4)),
      computed_at: now.toISOString(),
    };
  });
  if (rows.length > 0) {
    const { error: upErr } = await svc.from("drop_pressure").upsert(rows, { onConflict: "drop_id" });
    if (upErr) throw new Error(`pressure upsert failed: ${upErr.message}`);
  }
  return { drops: rows.length };
}

// ---------------------------------------------------------------------------
// Cold start (PRD §10.3): a city inside its window falls back to proximity for
// Local and fill-screen for Maker/Digital, until coldstart_days elapse OR
// coldstart_min_events are recorded, whichever comes first. "Events" here are
// catches on drops in the city (the primary activity signal).
// ---------------------------------------------------------------------------
async function isColdStart(cityId: string, now: Date): Promise<boolean> {
  const svc = getServiceClient();
  const { data: city, error } = await svc.from("cities").select("launched_at, coldstart_days, coldstart_min_events").eq("id", cityId).maybeSingle();
  if (error) throw new Error(`load city failed: ${error.message}`);
  if (!city) return true;
  const launchedAt = city.launched_at as string | null;
  const days = city.coldstart_days as number;
  const minEvents = city.coldstart_min_events as number;

  const withinDays = launchedAt === null || now.getTime() < new Date(launchedAt).getTime() + days * DAY_MS;
  if (!withinDays) return false; // disengaged: window elapsed

  // Count catches in the city (via the drop's city_id).
  const { data: cityDrops } = await svc.from("drops").select("id").eq("city_id", cityId);
  const dropIds = (cityDrops ?? []).map((d) => d.id as string);
  let events = 0;
  if (dropIds.length > 0) {
    const { count } = await svc.from("catches").select("id", { count: "exact", head: true }).in("drop_id", dropIds);
    events = count ?? 0;
  }
  return events < minEvents; // still cold if under the event threshold
}

export interface BoardOptions {
  addressId?: string;
  tagId?: string;
  sort?: "heat" | "distance" | "ending";
}

export async function getBoard(userId: string, opts: BoardOptions = {}): Promise<BoardResult> {
  const svc = getServiceClient();

  // Resolve the board's city from the active (or requested) address.
  let addressId = opts.addressId;
  if (!addressId) {
    const { data: u } = await svc.from("users").select("active_address_id").eq("id", userId).maybeSingle();
    addressId = (u?.active_address_id as string | null) ?? undefined;
  }
  if (!addressId) throw new ApiError("VALIDATION_ERROR", "Set an active address to see the board.");
  const { data: addr, error: aErr } = await svc.from("addresses").select("lat, lng").eq("id", addressId).eq("user_id", userId).maybeSingle();
  if (aErr) throw new Error(`load address failed: ${aErr.message}`);
  if (!addr || addr.lat === null || addr.lng === null) throw new ApiError("NOT_FOUND", "No such address.");
  const here = { lat: Number(addr.lat), lng: Number(addr.lng) };
  const cityId = await resolveCityId(here.lat, here.lng);

  const now = new Date();
  const cold = cityId ? await isColdStart(cityId, now) : true;

  // Optional category filter: restrict to drops whose org carries a leaf in the
  // selected tag (or any leaf of a selected group). Categories attach to the org
  // (org_tags), and a drop inherits its org's classification.
  let allowedOrgIds: Set<string> | null = null;
  if (opts.tagId) {
    const leafIds = await leafIdsForFilter(opts.tagId);
    if (leafIds.length === 0) allowedOrgIds = new Set();
    else {
      const { data: ot } = await svc.from("org_tags").select("org_id").in("tag_id", leafIds);
      allowedOrgIds = new Set((ot ?? []).map((r) => r.org_id as string));
    }
  }

  // Live drops in the city, with pressure + location coords. No city → no board.
  const data: Record<string, { on_fire: DropCard[]; new: DropCard[]; gone: DropCard[] }> = {
    local: { on_fire: [], new: [], gone: [] }, maker: { on_fire: [], new: [], gone: [] }, digital: { on_fire: [], new: [], gone: [] },
  };
  if (!cityId) return { data, meta: { city_id: null, cold_start: true, ranking: "proximity_fallback" } };

  const { data: drops, error: dErr } = await svc
    .from("drops")
    .select("id, lane, title, image_urls, quantity_total, quantity_remaining, price_cents, live_at, live_until, redeem_until, status, org_id, drop_pressure(pct_remaining), locations(lat, lng)")
    .eq("status", "live")
    .eq("city_id", cityId);
  if (dErr) throw new Error(`load board drops failed: ${dErr.message}`);

  let live: LiveDropRow[] = (drops ?? []).map((d) => {
    const pressure = (d.drop_pressure as unknown as { pct_remaining: number } | null)?.pct_remaining ?? null;
    const loc = d.locations as unknown as { lat: number | null; lng: number | null } | null;
    return {
      id: d.id as string, lane: d.lane as string, title: d.title as string, image_urls: (d.image_urls as string[] | null) ?? null,
      quantity_total: d.quantity_total as number, quantity_remaining: d.quantity_remaining as number, price_cents: (d.price_cents as number | null) ?? null,
      live_at: (d.live_at as string | null) ?? null, live_until: (d.live_until as string | null) ?? null, redeem_until: (d.redeem_until as string | null) ?? null,
      status: d.status as string, org_id: d.org_id as string,
      location_lat: loc?.lat ?? null, location_lng: loc?.lng ?? null,
      pct: pctOf(d.quantity_total as number, d.quantity_remaining as number, pressure),
    };
  });
  if (allowedOrgIds !== null) live = live.filter((d) => allowedOrgIds!.has(d.org_id));

  // redemption_rate per org (displayed only; never ranks).
  const orgIds = [...new Set(live.map((d) => d.org_id))];
  const rateByOrg = new Map<string, number | null>();
  const nameByOrg = new Map<string, string>();
  if (orgIds.length > 0) {
    const { data: scores } = await svc.from("merchant_scores").select("org_id, redemption_rate").in("org_id", orgIds);
    for (const s of scores ?? []) rateByOrg.set(s.org_id as string, (s.redemption_rate as number | null) ?? null);
    const { data: orgs } = await svc.from("organizations").select("id, name").in("id", orgIds);
    for (const o of orgs ?? []) nameByOrg.set(o.id as string, o.name as string);
  }

  const toCard = (d: LiveDropRow): DropCard => ({
    id: d.id, lane: d.lane, title: d.title, image_url: d.image_urls?.[0] ?? null,
    quantity_total: d.quantity_total, quantity_remaining: d.quantity_remaining, pct_remaining: Number(d.pct.toFixed(4)),
    price_cents: d.price_cents, live_until: d.live_until, redeem_until: d.redeem_until, status: d.status,
    merchant: { org_id: d.org_id, name: nameByOrg.get(d.org_id) ?? "", redemption_rate: rateByOrg.get(d.org_id) ?? null },
  });

  const byRecency = (a: LiveDropRow, b: LiveDropRow) => new Date(b.live_at ?? 0).getTime() - new Date(a.live_at ?? 0).getTime();
  const byHeat = (a: LiveDropRow, b: LiveDropRow) => (a.pct - b.pct) || byRecency(a, b); // pct asc, then recency
  const byEnding = (a: LiveDropRow, b: LiveDropRow) => new Date(a.redeem_until ?? 8.64e15).getTime() - new Date(b.redeem_until ?? 8.64e15).getTime();
  const byDistance = (a: LiveDropRow, b: LiveDropRow) => {
    const da = a.location_lat !== null && a.location_lng !== null ? distanceMiles(here, { lat: a.location_lat, lng: a.location_lng }) : Infinity;
    const db = b.location_lat !== null && b.location_lng !== null ? distanceMiles(here, { lat: b.location_lat, lng: b.location_lng }) : Infinity;
    return (da - db) || byRecency(a, b);
  };

  for (const lane of LANES) {
    const laneDrops = live.filter((d) => d.lane === lane);
    // On Fire ordering. Cold start overrides heat: Local → proximity, Maker/
    // Digital → fill-screen (recency). An explicit sort param wins when given.
    let onFireSort = byHeat;
    if (opts.sort === "distance") onFireSort = byDistance;
    else if (opts.sort === "ending") onFireSort = byEnding;
    else if (cold) onFireSort = lane === "local" ? byDistance : byRecency;
    const onFire = [...laneDrops].sort(onFireSort).slice(0, PER_LANE).map(toCard);
    const fresh = [...laneDrops].sort(byRecency).slice(0, PER_LANE).map(toCard);
    data[lane] = { on_fire: onFire, new: fresh, gone: [] };
  }

  // Recently-Gone drops stay on the board for 5 minutes (DESIGN-SYSTEM §4.9),
  // shadowed and unclickable, then leave. gone_at drives 'gone'; expired drops
  // use updated_at (they never set gone_at).
  const { data: goneRows } = await svc
    .from("drops")
    .select("id, lane, title, image_urls, quantity_total, quantity_remaining, price_cents, live_until, redeem_until, status, org_id, gone_at, updated_at")
    .in("status", ["gone", "expired"])
    .eq("city_id", cityId);
  const cutoff = now.getTime() - GONE_BOARD_MS;
  const goneOrgIds = new Set<string>();
  const recentGone = (goneRows ?? []).filter((d) => {
    const at = (d.status === "gone" ? (d.gone_at as string | null) : (d.updated_at as string | null)) ?? null;
    return at !== null && new Date(at).getTime() >= cutoff;
  });
  for (const d of recentGone) goneOrgIds.add(d.org_id as string);
  if (goneOrgIds.size > 0) {
    const { data: gorgs } = await svc.from("organizations").select("id, name").in("id", [...goneOrgIds]);
    for (const o of gorgs ?? []) nameByOrg.set(o.id as string, o.name as string);
  }
  for (const d of recentGone) {
    if (allowedOrgIds !== null && !allowedOrgIds.has(d.org_id as string)) continue;
    const lane = d.lane as string;
    if (!data[lane]) continue;
    const qt = d.quantity_total as number;
    const qr = d.quantity_remaining as number;
    data[lane].gone.push({
      id: d.id as string, lane, title: d.title as string, image_url: (d.image_urls as string[] | null)?.[0] ?? null,
      quantity_total: qt, quantity_remaining: qr, pct_remaining: Number((qt > 0 ? qr / qt : 0).toFixed(4)),
      price_cents: (d.price_cents as number | null) ?? null, live_until: (d.live_until as string | null) ?? null,
      redeem_until: (d.redeem_until as string | null) ?? null, status: d.status as string,
      merchant: { org_id: d.org_id as string, name: nameByOrg.get(d.org_id as string) ?? "", redemption_rate: rateByOrg.get(d.org_id as string) ?? null },
    });
  }

  return { data, meta: { city_id: cityId, cold_start: cold, ranking: cold ? "proximity_fallback" : "pressure" } };
}

// ---------------------------------------------------------------------------
// Public drop detail (API-CONTRACT §4). No auth required — the shared-link
// surface. `can_catch` is server-computed; the client renders it, never decides.
// ---------------------------------------------------------------------------
export interface PublicDrop {
  id: string; lane: string; title: string; description: string; terms: string | null;
  image_urls: string[]; quantity_remaining: number; quantity_total: number; pct_remaining: number;
  price_cents: number | null; live_until: string | null; redeem_from: string | null; redeem_until: string | null;
  status: string;
  merchant: { org_id: string; name: string; redemption_rate: number | null; location: { name: string; city: string; lat: number; lng: number } | null };
  can_catch: boolean;
  catch_blocked_reason: string | null;
}

const PUBLIC_STATUSES = new Set(["live", "gone", "expired", "encore_pending"]);

export async function getPublicDrop(dropId: string, viewerUserId: string | null): Promise<PublicDrop> {
  const svc = getServiceClient();
  const { data: d, error } = await svc
    .from("drops")
    .select("id, lane, title, description, terms, image_urls, quantity_total, quantity_remaining, price_cents, live_until, redeem_from, redeem_until, status, org_id, location_id, drop_pressure(pct_remaining), organizations(name), locations(name, city, lat, lng)")
    .eq("id", dropId)
    .maybeSingle();
  if (error) throw new Error(`load drop failed: ${error.message}`);
  if (!d || !PUBLIC_STATUSES.has(d.status as string)) throw new ApiError("NOT_FOUND", "No such drop.");

  const org = d.organizations as unknown as { name: string } | null;
  const loc = d.locations as unknown as { name: string; city: string; lat: number; lng: number } | null;
  const pressure = (d.drop_pressure as unknown as { pct_remaining: number } | null)?.pct_remaining ?? null;
  const qt = d.quantity_total as number;
  const qr = d.quantity_remaining as number;

  let redemptionRate: number | null = null;
  const { data: ms } = await svc.from("merchant_scores").select("redemption_rate").eq("org_id", d.org_id as string).maybeSingle();
  redemptionRate = (ms?.redemption_rate as number | null) ?? null;

  // can_catch — server-computed. A true value is a display hint, not a promise:
  // POST /v1/catches (Redis) remains the sole authority on a catch succeeding.
  let canCatch = false;
  let reason: string | null = "UNAUTHENTICATED";
  if (viewerUserId) {
    const { data: viewer } = await svc.from("users").select("suspended_at, location_perm_granted_at").eq("id", viewerUserId).maybeSingle();
    if (!viewer) { reason = "UNAUTHENTICATED"; }
    else if (viewer.suspended_at !== null) { reason = "ACCOUNT_SUSPENDED"; }
    else if ((d.status as string) !== "live") { reason = "DROP_NOT_LIVE"; }
    else if (viewer.location_perm_granted_at === null) { reason = "LOCATION_PERMISSION_REQUIRED"; }
    else {
      const { data: prior } = await svc.from("catches").select("id").eq("drop_id", dropId).eq("original_user_id", viewerUserId).maybeSingle();
      if (prior) { reason = "ALREADY_CAUGHT"; }
      else { canCatch = true; reason = null; }
    }
  }

  return {
    id: d.id as string, lane: d.lane as string, title: d.title as string, description: d.description as string, terms: (d.terms as string | null) ?? null,
    image_urls: (d.image_urls as string[] | null) ?? [], quantity_remaining: qr, quantity_total: qt, pct_remaining: Number(pctOf(qt, qr, pressure).toFixed(4)),
    price_cents: (d.price_cents as number | null) ?? null, live_until: (d.live_until as string | null) ?? null, redeem_from: (d.redeem_from as string | null) ?? null, redeem_until: (d.redeem_until as string | null) ?? null,
    status: d.status as string,
    merchant: {
      org_id: d.org_id as string, name: org?.name ?? "", redemption_rate: redemptionRate,
      location: loc ? { name: loc.name, city: loc.city, lat: Number(loc.lat), lng: Number(loc.lng) } : null,
    },
    can_catch: canCatch,
    catch_blocked_reason: reason,
  };
}
