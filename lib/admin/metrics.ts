import { getServiceClient } from "@/lib/supabase/server";

/**
 * Platform metrics (API-CONTRACT §11), including the saved-address demand map:
 * where buyers have saved addresses is where demand already is, which guides
 * which market to launch next. Read-only aggregation.
 */

export interface DemandPoint {
  city: string;
  region: string;
  saved_addresses: number;
  lat: number | null; // centroid of saved addresses in this city
  lng: number | null;
}

export interface PlatformMetrics {
  users: number;
  orgs_active: number;
  drops_live: number;
  catches_total: number;
  redemptions_total: number;
  cities_launched: number;
  demand_map: DemandPoint[];
}

export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  const svc = getServiceClient();

  const countOf = async (table: string): Promise<number> => {
    const { count, error } = await svc.from(table).select("id", { count: "exact", head: true });
    if (error) throw new Error(`count ${table} failed: ${error.message}`);
    return count ?? 0;
  };

  const users = await countOf("users");
  const catches = await countOf("catches");
  const redemptions = await countOf("redemptions");

  const { count: orgsActive, error: orgsErr } = await svc.from("organizations").select("id", { count: "exact", head: true }).eq("status", "active");
  if (orgsErr) throw new Error(`metrics active orgs count failed: ${orgsErr.message}`);
  const { count: dropsLive, error: dropsErr } = await svc.from("drops").select("id", { count: "exact", head: true }).eq("status", "live");
  if (dropsErr) throw new Error(`metrics live drops count failed: ${dropsErr.message}`);
  const { count: citiesLaunched, error: citiesErr } = await svc.from("cities").select("id", { count: "exact", head: true }).eq("active", true);
  if (citiesErr) throw new Error(`metrics launched cities count failed: ${citiesErr.message}`);

  // Demand map: aggregate saved addresses by city, with a centroid for plotting.
  const { data: addrs, error: aErr } = await svc.from("addresses").select("city, region, lat, lng").limit(100000);
  if (aErr) throw new Error(`demand map failed: ${aErr.message}`);
  const byCity = new Map<string, { city: string; region: string; n: number; latSum: number; lngSum: number; geo: number }>();
  for (const a of addrs ?? []) {
    const city = (a.city as string) ?? "";
    const region = (a.region as string) ?? "";
    const key = `${city}|${region}`.toLowerCase();
    const cur = byCity.get(key) ?? { city, region, n: 0, latSum: 0, lngSum: 0, geo: 0 };
    cur.n += 1;
    if (a.lat !== null && a.lng !== null) { cur.latSum += Number(a.lat); cur.lngSum += Number(a.lng); cur.geo += 1; }
    byCity.set(key, cur);
  }
  const demand_map: DemandPoint[] = [...byCity.values()]
    .map((c) => ({
      city: c.city, region: c.region, saved_addresses: c.n,
      lat: c.geo > 0 ? Number((c.latSum / c.geo).toFixed(6)) : null,
      lng: c.geo > 0 ? Number((c.lngSum / c.geo).toFixed(6)) : null,
    }))
    .sort((a, b) => b.saved_addresses - a.saved_addresses);

  return {
    users,
    orgs_active: orgsActive ?? 0,
    drops_live: dropsLive ?? 0,
    catches_total: catches,
    redemptions_total: redemptions,
    cities_launched: citiesLaunched ?? 0,
    demand_map,
  };
}
