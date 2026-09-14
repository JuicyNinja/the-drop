import { ApiError } from "@/lib/api/errors";
import { sanitizeText } from "@/lib/sanitize";
import { getServiceClient } from "@/lib/supabase/server";
import { getGeocoder } from "@/lib/geo/geocoder";
import { currentCycle } from "@/lib/billing/allowance";
import { isSelfServeTier, seedLimitsFor, upgradeOptions } from "@/lib/billing/tiers";
import { isAdmin } from "@/lib/auth/org-access";
import type { UserRecord } from "@/lib/users";

/**
 * Organization, location, and staff management. Limits are stored on the org
 * row at creation (seeded from the tier catalog for self-serve tiers, set to
 * arbitrary values by admin for Enterprise) and read from that row thereafter —
 * never derived from the tier enum.
 */

export interface OrgRecord {
  id: string;
  name: string;
  lane: string;
  status: string;
  tier: string;
  max_locations: number;
  drops_per_cycle: number;
  drops_pooled_org_level: boolean;
  cycle_anchor_at: string;
  created_at: string;
}

const ORG_COLUMNS =
  "id, name, lane, status, tier, max_locations, drops_per_cycle, drops_pooled_org_level, cycle_anchor_at, created_at";

export interface LocationRecord {
  id: string;
  org_id: string;
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  lat: number;
  lng: number;
  geofence_radius_m: number;
  active: boolean;
  created_at: string;
}

const LOCATION_COLUMNS =
  "id, org_id, name, line1, line2, city, region, postal_code, country, lat, lng, geofence_radius_m, active, created_at";

export interface CreateOrgInput {
  name: string;
  lane?: "local" | "maker" | "digital";
  tier: string;
  // Admin/Enterprise only: explicit stored limits.
  max_locations?: number;
  drops_per_cycle?: number;
  drops_pooled_org_level?: boolean;
}

export async function getOrg(orgId: string): Promise<OrgRecord> {
  const { data, error } = await getServiceClient().from("organizations").select(ORG_COLUMNS).eq("id", orgId).maybeSingle();
  if (error) throw new Error(`load org failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such organization.");
  return data as OrgRecord;
}

export async function createOrg(caller: UserRecord, input: CreateOrgInput): Promise<OrgRecord> {
  const name = sanitizeText(input.name, 120);
  if (!name) throw new ApiError("VALIDATION_ERROR", "Invalid name.", { body: [{ path: "name", message: "required" }] });
  const lane = input.lane ?? "local";

  const wantsCustom =
    input.max_locations !== undefined ||
    input.drops_per_cycle !== undefined ||
    input.drops_pooled_org_level !== undefined ||
    input.tier === "local_enterprise";

  let limits: { max_locations: number; drops_per_cycle: number; pooled: boolean };

  if (wantsCustom) {
    // Enterprise / custom limits are admin-provisioned (PRD §12.7).
    if (!(await isAdmin(caller))) {
      throw new ApiError("FORBIDDEN", "Enterprise and custom limits are set by an administrator.");
    }
    if (input.max_locations === undefined || input.drops_per_cycle === undefined) {
      throw new ApiError("VALIDATION_ERROR", "Custom limits require max_locations and drops_per_cycle.", {
        body: [{ path: "max_locations", message: "required for custom/enterprise" }],
      });
    }
    limits = {
      max_locations: input.max_locations,
      drops_per_cycle: input.drops_per_cycle,
      pooled: input.drops_pooled_org_level ?? true,
    };
  } else {
    if (!isSelfServeTier(input.tier)) {
      throw new ApiError("VALIDATION_ERROR", "Unknown tier.", { body: [{ path: "tier", message: "unknown" }] });
    }
    limits = seedLimitsFor(input.tier);
  }

  const { data, error } = await getServiceClient().rpc("app_create_org", {
    p_owner: caller.id,
    p_name: name,
    p_lane: lane,
    p_tier: input.tier,
    p_max_locations: limits.max_locations,
    p_drops_per_cycle: limits.drops_per_cycle,
    p_pooled: limits.pooled,
  });
  if (error) throw new Error(`create org failed: ${error.message}`);
  return data as OrgRecord;
}

export async function listLocations(orgId: string): Promise<LocationRecord[]> {
  const { data, error } = await getServiceClient()
    .from("locations")
    .select(LOCATION_COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`list locations failed: ${error.message}`);
  return (data ?? []) as LocationRecord[];
}

export async function countActiveLocations(orgId: string): Promise<number> {
  const { count, error } = await getServiceClient()
    .from("locations")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("active", true);
  if (error) throw new Error(`count locations failed: ${error.message}`);
  return count ?? 0;
}

/** Build the 402 upgrade payload for the location cap (limits from the org row). */
function locationCapError(org: OrgRecord): ApiError {
  const cycle = currentCycle(org.cycle_anchor_at);
  const { options, enterprise_contact } = upgradeOptions(org.tier, "locations", cycle.end);
  return new ApiError("ALLOWANCE_EXHAUSTED", `Your plan covers ${org.max_locations} location${org.max_locations === 1 ? "" : "s"}.`, {
    current_tier: org.tier,
    max_locations: org.max_locations,
    upgrade_options: options,
    enterprise_contact,
  });
}

export interface CreateLocationInput {
  name: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postal_code: string;
  country?: string | null;
  geofence_radius_m?: number;
}

export async function createLocation(org: OrgRecord, input: CreateLocationInput): Promise<LocationRecord> {
  // Cap enforced on stored max_locations, never a tier default.
  if ((await countActiveLocations(org.id)) >= org.max_locations) {
    throw locationCapError(org);
  }

  const clean = {
    name: sanitizeText(input.name, 120),
    line1: sanitizeText(input.line1, 200),
    line2: input.line2 ? sanitizeText(input.line2, 200) : null,
    city: sanitizeText(input.city, 120),
    region: sanitizeText(input.region, 80),
    postal_code: sanitizeText(input.postal_code, 20),
    country: input.country ? sanitizeText(input.country, 2) : "US",
    geofence_radius_m: input.geofence_radius_m ?? 150,
  };
  const geo = await getGeocoder().geocode(clean);

  const { data, error } = await getServiceClient()
    .from("locations")
    .insert({ org_id: org.id, ...clean, lat: geo.lat, lng: geo.lng })
    .select(LOCATION_COLUMNS)
    .single();
  if (error) throw new Error(`create location failed: ${error.message}`);
  return data as LocationRecord;
}

export async function getLocation(locationId: string): Promise<LocationRecord> {
  const { data, error } = await getServiceClient().from("locations").select(LOCATION_COLUMNS).eq("id", locationId).maybeSingle();
  if (error) throw new Error(`load location failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such location.");
  return data as LocationRecord;
}

export interface PatchLocationInput {
  name?: string;
  line1?: string;
  line2?: string | null;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string | null;
  geofence_radius_m?: number;
  active?: boolean;
}

const LOCATION_LINE_FIELDS = ["line1", "line2", "city", "region", "postal_code", "country"] as const;

export async function updateLocation(locationId: string, patch: PatchLocationInput): Promise<LocationRecord> {
  const existing = await getLocation(locationId);
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = sanitizeText(patch.name, 120);
  if (patch.line1 !== undefined) update.line1 = sanitizeText(patch.line1, 200);
  if (patch.line2 !== undefined) update.line2 = patch.line2 ? sanitizeText(patch.line2, 200) : null;
  if (patch.city !== undefined) update.city = sanitizeText(patch.city, 120);
  if (patch.region !== undefined) update.region = sanitizeText(patch.region, 80);
  if (patch.postal_code !== undefined) update.postal_code = sanitizeText(patch.postal_code, 20);
  if (patch.country !== undefined) update.country = patch.country ? sanitizeText(patch.country, 2) : "US";
  if (patch.geofence_radius_m !== undefined) update.geofence_radius_m = patch.geofence_radius_m;
  if (patch.active !== undefined) update.active = patch.active;

  const lineChanged = LOCATION_LINE_FIELDS.some(
    (f) => update[f] !== undefined && update[f] !== (existing[f] ?? (f === "country" ? "US" : null)),
  );
  if (lineChanged) {
    const merged = {
      line1: (update.line1 as string) ?? existing.line1,
      line2: (update.line2 as string | null) ?? existing.line2,
      city: (update.city as string) ?? existing.city,
      region: (update.region as string) ?? existing.region,
      postal_code: (update.postal_code as string) ?? existing.postal_code,
      country: (update.country as string) ?? existing.country,
    };
    const geo = await getGeocoder().geocode(merged);
    update.lat = geo.lat;
    update.lng = geo.lng;
  }
  if (Object.keys(update).length === 0) return existing;

  const { data, error } = await getServiceClient().from("locations").update(update).eq("id", locationId).select(LOCATION_COLUMNS).single();
  if (error) throw new Error(`update location failed: ${error.message}`);
  return data as LocationRecord;
}

/** Soft delete: deactivate. Drops reference the location, so the row is kept. */
export async function deactivateLocation(locationId: string): Promise<void> {
  const { error } = await getServiceClient().from("locations").update({ active: false }).eq("id", locationId);
  if (error) throw new Error(`deactivate location failed: ${error.message}`);
}

export interface StaffSeat {
  user_id: string;
  location_id: string;
  granted_at: string;
}

export async function addStaff(orgId: string, grantedBy: string, userId: string, locationId: string): Promise<StaffSeat> {
  // The location must belong to this org — a seat is scoped to one location.
  const loc = await getLocation(locationId);
  if (loc.org_id !== orgId) {
    throw new ApiError("VALIDATION_ERROR", "That location does not belong to this organization.", {
      body: [{ path: "location_id", message: "wrong org" }],
    });
  }
  const { error } = await getServiceClient()
    .from("user_roles")
    .insert({ user_id: userId, role: "merchant_staff", org_id: orgId, location_id: locationId, granted_by: grantedBy });
  if (error) {
    if (error.code === "23505") throw new ApiError("VALIDATION_ERROR", "That user already has a role in this organization.");
    if (error.code === "23503") throw new ApiError("NOT_FOUND", "No such user.");
    throw new Error(`add staff failed: ${error.message}`);
  }
  return { user_id: userId, location_id: locationId, granted_at: new Date().toISOString() };
}

export async function listStaff(orgId: string): Promise<StaffSeat[]> {
  const { data, error } = await getServiceClient()
    .from("user_roles")
    .select("user_id, location_id, granted_at")
    .eq("org_id", orgId)
    .eq("role", "merchant_staff");
  if (error) throw new Error(`list staff failed: ${error.message}`);
  return (data ?? []) as StaffSeat[];
}
