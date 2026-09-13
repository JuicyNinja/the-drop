import { getServiceClient } from "@/lib/supabase/server";
import { distanceMiles } from "@/lib/geo/distance";

/**
 * The active address resolved to a discovery market, and the discovery query
 * the Local board (WP-11) is built on. Reads the ACTIVE address only. This is
 * the discovery half of invariant #10; the redemption half (live GPS) never
 * touches any of this.
 */

export interface ActiveMarket {
  active_address_id: string;
  label: string;
  center: { lat: number; lng: number } | null;
  radius_miles: number;
  nearest_city: { id: string; name: string; region: string } | null;
}

export async function resolveActiveMarket(userId: string): Promise<ActiveMarket | null> {
  const svc = getServiceClient();
  const { data, error } = await svc
    .from("users")
    .select("active_address_id, addresses!fk_active_address(id, label, lat, lng, radius_miles)")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`resolve market failed: ${error.message}`);
  const addr = (data?.addresses as unknown as {
    id: string;
    label: string;
    lat: number | null;
    lng: number | null;
    radius_miles: number;
  } | null) ?? null;
  if (!addr) return null;

  const center = addr.lat !== null && addr.lng !== null ? { lat: addr.lat, lng: addr.lng } : null;

  let nearest: ActiveMarket["nearest_city"] = null;
  if (center) {
    const { data: cities } = await svc.from("cities").select("id, name, region, lat, lng");
    let best = Infinity;
    for (const c of cities ?? []) {
      const d = distanceMiles(center, { lat: c.lat as number, lng: c.lng as number });
      if (d < best) {
        best = d;
        nearest = { id: c.id as string, name: c.name as string, region: c.region as string };
      }
    }
  }

  return {
    active_address_id: addr.id,
    label: addr.label,
    center,
    radius_miles: addr.radius_miles,
    nearest_city: nearest,
  };
}

export interface DiscoveredDrop {
  id: string;
  title: string;
  location_id: string;
  distance_miles: number;
}

/** Live local drops within the active address's radius, nearest first. */
export async function discoverLocalDrops(userId: string): Promise<DiscoveredDrop[]> {
  const { data, error } = await getServiceClient().rpc("app_discover_local_drops", {
    p_user_id: userId,
  });
  if (error) throw new Error(`discover local drops failed: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    title: r.title as string,
    location_id: r.location_id as string,
    distance_miles: Number(r.distance_miles),
  }));
}
