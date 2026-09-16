import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * The public business profile (PRD §11, invariant #11). A Gone drop is never
 * deleted and never hidden: after it leaves the board (5 minutes) it stays
 * PERMANENTLY reachable here, under the merchant's profile, carrying its Gone
 * state. This is the endpoint that makes "permanently reachable" true — before
 * it, nothing surfaced a merchant's past drops. Public (no auth), like the
 * shared drop-link surface.
 */

export interface ProfileCard {
  id: string;
  title: string;
  quantity_total: number;
  quantity_remaining: number;
  pct_remaining: number;
  status: string;
  redeem_until: string | null;
  gone_at: string | null;
}

export interface OrgProfile {
  org_id: string;
  name: string;
  lane: string;
  redemption_rate: number | null;
  locations: { name: string; city: string; region: string }[];
  live: ProfileCard[];
  gone: ProfileCard[];
}

const PROFILE_STATUSES = ["live", "gone", "expired", "encore_pending"] as const;

function toCard(d: Record<string, unknown>): ProfileCard {
  const qt = d.quantity_total as number;
  const qr = d.quantity_remaining as number;
  return {
    id: d.id as string,
    title: d.title as string,
    quantity_total: qt,
    quantity_remaining: qr,
    pct_remaining: Number((qt > 0 ? qr / qt : 0).toFixed(4)),
    status: d.status as string,
    redeem_until: (d.redeem_until as string | null) ?? null,
    gone_at: (d.gone_at as string | null) ?? null,
  };
}

export async function getOrgProfile(orgId: string): Promise<OrgProfile> {
  const svc = getServiceClient();

  const { data: org, error: oErr } = await svc
    .from("organizations")
    .select("id, name, lane, status")
    .eq("id", orgId)
    .maybeSingle();
  if (oErr) throw new Error(`load org failed: ${oErr.message}`);
  // A delisted org is removed from discovery, but its profile (and its Gone
  // drops) stays reachable — invariant #11 is about permanence, not visibility
  // in search. Only a truly absent org is a 404.
  if (!org) throw new ApiError("NOT_FOUND", "No such business.");

  const { data: ms } = await svc.from("merchant_scores").select("redemption_rate").eq("org_id", orgId).maybeSingle();
  const { data: locs } = await svc.from("locations").select("name, city, region").eq("org_id", orgId).eq("active", true).order("created_at", { ascending: true });

  const { data: drops, error: dErr } = await svc
    .from("drops")
    .select("id, title, quantity_total, quantity_remaining, status, redeem_until, gone_at, live_at")
    .eq("org_id", orgId)
    .in("status", PROFILE_STATUSES)
    .order("live_at", { ascending: false })
    .limit(500);
  if (dErr) throw new Error(`load org drops failed: ${dErr.message}`);

  const live: ProfileCard[] = [];
  const gone: ProfileCard[] = [];
  for (const d of drops ?? []) {
    const card = toCard(d as Record<string, unknown>);
    (card.status === "live" || card.status === "encore_pending" ? live : gone).push(card);
  }

  return {
    org_id: org.id as string,
    name: org.name as string,
    lane: org.lane as string,
    redemption_rate: (ms?.redemption_rate as number | null) ?? null,
    locations: (locs ?? []).map((l) => ({ name: l.name as string, city: l.city as string, region: l.region as string })),
    live,
    gone,
  };
}
