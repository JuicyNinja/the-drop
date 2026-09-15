import { getServiceClient } from "@/lib/supabase/server";
import { distanceMiles } from "@/lib/geo/distance";

/**
 * Resolve a location's city from its geocoded coordinates (WP-10 fix). Every
 * location MUST map to a known city: a city-less location silently drops every
 * clout event that happens there (no leaderboard to join). So resolution is a
 * hard step at create — a location that maps to no city is a create-time error
 * the merchant sees, never a silent downstream failure.
 *
 * Match is nearest city within a metro radius. Cities are matched regardless of
 * their `active` flag — `active` governs board launch (WP-14), not whether a
 * location exists or whether clout accrues there. Nearest-wins disambiguates
 * neighbouring metros (Salt Lake City vs Provo, ~43 miles apart).
 */
export const CITY_MATCH_MAX_MILES = 60;

export async function resolveCityId(lat: number, lng: number): Promise<string | null> {
  const { data, error } = await getServiceClient().from("cities").select("id, lat, lng");
  if (error) throw new Error(`load cities failed: ${error.message}`);
  let best: { id: string; miles: number } | null = null;
  for (const c of data ?? []) {
    const miles = distanceMiles({ lat, lng }, { lat: Number(c.lat), lng: Number(c.lng) });
    if (best === null || miles < best.miles) best = { id: c.id as string, miles };
  }
  if (best === null || best.miles > CITY_MATCH_MAX_MILES) return null;
  return best.id;
}
