import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";
import { getOrg } from "@/lib/orgs";
import { currentCycle } from "@/lib/billing/allowance";

/**
 * Operator-portal read models (PRD §10, DESIGN-SYSTEM §9): the persistent
 * scoreboard, the drops list, and per-drop stats. All owner/admin only (the
 * routes enforce it). drops_used/remaining come from the stored allowance, never
 * a tier default (CLAUDE.md hard-thing #3).
 */

export interface Scoreboard {
  drops_used: number;
  drops_remaining: number;
  live_now: number;
  total_catches: number;
  total_redemptions: number;
  whispers: number;
  cycle_ends_at: string;
  drops_pooled_org_level: boolean;
}

async function orgDropIds(orgId: string): Promise<string[]> {
  const { data, error } = await getServiceClient().from("drops").select("id").eq("org_id", orgId);
  if (error) throw new Error(`org drop ids load failed: ${error.message}`);
  return (data ?? []).map((d) => d.id as string);
}

export async function getScoreboard(orgId: string): Promise<Scoreboard> {
  const svc = getServiceClient();
  const org = await getOrg(orgId);
  const cycle = currentCycle(org.cycle_anchor_at);

  const { count: used, error: usedErr } = await svc.from("drops").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).neq("status", "draft").gte("created_at", cycle.start);
  if (usedErr) throw new Error(`scoreboard drops-used count failed: ${usedErr.message}`);
  const dropsUsed = used ?? 0;

  const { count: live, error: liveErr } = await svc.from("drops").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "live");
  if (liveErr) throw new Error(`scoreboard live count failed: ${liveErr.message}`);

  const dropIds = await orgDropIds(orgId);
  let catches = 0, redemptions = 0;
  if (dropIds.length > 0) {
    const c = await svc.from("catches").select("id", { count: "exact", head: true }).in("drop_id", dropIds);
    if (c.error) throw new Error(`scoreboard catches count failed: ${c.error.message}`);
    catches = c.count ?? 0;
    const r = await svc.from("redemptions").select("id", { count: "exact", head: true }).in("drop_id", dropIds);
    if (r.error) throw new Error(`scoreboard redemptions count failed: ${r.error.message}`);
    redemptions = r.count ?? 0;
  }
  const { count: whispers, error: whispersErr } = await svc.from("whispers").select("id", { count: "exact", head: true }).eq("org_id", orgId);
  if (whispersErr) throw new Error(`scoreboard whispers count failed: ${whispersErr.message}`);

  return {
    drops_used: dropsUsed,
    drops_remaining: Math.max(0, org.drops_per_cycle - dropsUsed),
    live_now: live ?? 0,
    total_catches: catches,
    total_redemptions: redemptions,
    whispers: whispers ?? 0,
    cycle_ends_at: cycle.end,
    drops_pooled_org_level: org.drops_pooled_org_level,
  };
}

export interface OperatorDrop {
  id: string;
  title: string;
  description: string;
  terms: string | null;
  status: string;
  quantity_total: number;
  quantity_remaining: number;
  price_cents: number | null;
  live_at: string | null;
  live_until: string | null;
  redeem_from: string | null;
  redeem_until: string | null;
  redeem_days: number[] | null;
  redeem_time_start: string | null;
  redeem_time_end: string | null;
  location_id: string | null;
}

/**
 * The operator Drops list. Carries the full editable field set (description,
 * terms, windows) so the Edit form pre-fills from this list without a per-drop
 * read — the public GET /v1/drops/{id} deliberately excludes draft/scheduled,
 * which are exactly the editable states.
 */
export async function listOrgDrops(orgId: string): Promise<OperatorDrop[]> {
  const { data, error } = await getServiceClient()
    .from("drops")
    .select("id, title, description, terms, status, quantity_total, quantity_remaining, price_cents, live_at, live_until, redeem_from, redeem_until, redeem_days, redeem_time_start, redeem_time_end, location_id")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`list org drops failed: ${error.message}`);
  return (data ?? []).map((d) => ({
    id: d.id as string, title: d.title as string,
    description: (d.description as string | null) ?? "", terms: (d.terms as string | null) ?? null,
    status: d.status as string,
    quantity_total: d.quantity_total as number, quantity_remaining: d.quantity_remaining as number,
    price_cents: (d.price_cents as number | null) ?? null,
    live_at: (d.live_at as string | null) ?? null, live_until: (d.live_until as string | null) ?? null,
    redeem_from: (d.redeem_from as string | null) ?? null, redeem_until: (d.redeem_until as string | null) ?? null,
    redeem_days: (d.redeem_days as number[] | null) ?? null,
    redeem_time_start: (d.redeem_time_start as string | null) ?? null, redeem_time_end: (d.redeem_time_end as string | null) ?? null,
    location_id: (d.location_id as string | null) ?? null,
  }));
}

export interface DropStats {
  drop_id: string;
  status: string;
  quantity_total: number;
  quantity_remaining: number;
  pct_remaining: number;
  catches: number;
  redemptions: number;
  redemption_rate: number | null;
  gps_verified: number;
  unverified_timeout: number;
}

export async function getDropStats(dropId: string): Promise<DropStats> {
  const svc = getServiceClient();
  const { data: drop, error } = await svc.from("drops").select("id, status, quantity_total, quantity_remaining").eq("id", dropId).maybeSingle();
  if (error) throw new Error(`load drop failed: ${error.message}`);
  if (!drop) throw new ApiError("NOT_FOUND", "No such drop.");

  const { count: catches, error: catchErr } = await svc.from("catches").select("id", { count: "exact", head: true }).eq("drop_id", dropId);
  if (catchErr) throw new Error(`drop stats catch count failed: ${catchErr.message}`);
  const { data: reds, error: redsErr } = await svc.from("redemptions").select("method").eq("drop_id", dropId);
  if (redsErr) throw new Error(`drop stats redemptions failed: ${redsErr.message}`);
  const redemptions = (reds ?? []).length;
  const gpsVerified = (reds ?? []).filter((r) => r.method === "gps_verified").length;
  const unverified = (reds ?? []).filter((r) => r.method === "unverified_timeout").length;
  const qt = drop.quantity_total as number;
  const qr = drop.quantity_remaining as number;

  return {
    drop_id: dropId,
    status: drop.status as string,
    quantity_total: qt,
    quantity_remaining: qr,
    pct_remaining: Number((qt > 0 ? qr / qt : 0).toFixed(4)),
    catches: catches ?? 0,
    redemptions,
    redemption_rate: (catches ?? 0) > 0 ? Number((redemptions / (catches ?? 1)).toFixed(4)) : null,
    gps_verified: gpsVerified,
    unverified_timeout: unverified,
  };
}
