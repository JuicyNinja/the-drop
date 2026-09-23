import { ApiError } from "@/lib/api/errors";
import { sanitizeText } from "@/lib/sanitize";
import { getServiceClient } from "@/lib/supabase/server";
import { getGeocoder } from "@/lib/geo/geocoder";
import { resolveCityId } from "@/lib/cities";
import { currentCycle } from "@/lib/billing/allowance";
import { isSelfServeTier, seedLimitsFor, upgradeOptions } from "@/lib/billing/tiers";
import { isAdmin } from "@/lib/auth/org-access";
import { getUserByHandle } from "@/lib/users";
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
  logo_url: string | null;
  max_locations: number;
  drops_per_cycle: number;
  drops_pooled_org_level: boolean;
  cycle_anchor_at: string;
  created_at: string;
}

const ORG_COLUMNS =
  "id, name, lane, status, tier, logo_url, max_locations, drops_per_cycle, drops_pooled_org_level, cycle_anchor_at, created_at";

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

export interface PatchOrgInput {
  name?: string;
  logo_url?: string | null;
}

/**
 * Owner-editable org profile fields (name, logo). Limits, tier, and lane are NOT
 * editable here — they are billing-governed and admin-provisioned (§12.7); this
 * is the merchant's own branding surface. A logo is stored as its URL (a static
 * path or a small data: URI), and cleared with null.
 */
export async function updateOrg(orgId: string, patch: PatchOrgInput): Promise<OrgRecord> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = sanitizeText(patch.name, 120);
    if (!name) throw new ApiError("VALIDATION_ERROR", "Invalid name.", { body: [{ path: "name", message: "required" }] });
    update.name = name;
  }
  if (patch.logo_url !== undefined) update.logo_url = patch.logo_url;
  if (Object.keys(update).length === 0) return getOrg(orgId);

  const { data, error } = await getServiceClient().from("organizations").update(update).eq("id", orgId).select(ORG_COLUMNS).maybeSingle();
  if (error) throw new Error(`update org failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such organization.");
  return data as OrgRecord;
}

/**
 * The orgs the caller has a merchant role on (API-CONTRACT §10). This is how the
 * operator portal discovers its org context — a role without a scope is
 * meaningless, so this resolves each merchant role to its org and locations.
 *
 * Multi-org is the general case (own one shop, work staff shifts at another), so
 * this is always an array — empty for a pure buyer, never a 403. When a person
 * holds both roles on one org, owner wins. A staff member sees only the
 * location(s) their seat is scoped to; an owner sees all of the org's.
 */
export interface OrgMembership {
  org_id: string;
  name: string;
  lane: string;
  role: "merchant_owner" | "merchant_staff";
  tier: string;
  status: string;
  locations: { id: string; name: string; city: string }[];
}

export async function listOrgsForUser(userId: string): Promise<OrgMembership[]> {
  const svc = getServiceClient();
  const { data: roleRows, error } = await svc
    .from("user_roles")
    .select("role, org_id, location_id")
    .eq("user_id", userId)
    .in("role", ["merchant_owner", "merchant_staff"]);
  if (error) throw new Error(`load memberships failed: ${error.message}`);

  // Collapse to one entry per org; owner beats staff, staff seats accumulate.
  const byOrg = new Map<string, { role: "merchant_owner" | "merchant_staff"; seatLocationIds: Set<string> }>();
  for (const r of roleRows ?? []) {
    const orgId = r.org_id as string | null;
    if (!orgId) continue;
    const role = r.role as "merchant_owner" | "merchant_staff";
    const entry = byOrg.get(orgId);
    if (!entry) {
      byOrg.set(orgId, { role, seatLocationIds: new Set(r.location_id ? [r.location_id as string] : []) });
    } else {
      if (role === "merchant_owner") entry.role = "merchant_owner";
      if (r.location_id) entry.seatLocationIds.add(r.location_id as string);
    }
  }
  const orgIds = [...byOrg.keys()];
  if (orgIds.length === 0) return [];

  const [{ data: orgs }, { data: locs }] = await Promise.all([
    svc.from("organizations").select("id, name, lane, tier, status").in("id", orgIds),
    svc.from("locations").select("id, org_id, name, city").in("org_id", orgIds).order("created_at", { ascending: true }),
  ]);
  const orgById = new Map((orgs ?? []).map((o) => [o.id as string, o]));

  const result: OrgMembership[] = [];
  for (const [orgId, m] of byOrg) {
    const org = orgById.get(orgId);
    if (!org) continue; // role on a vanished org — skip rather than surface a broken row
    let locations = (locs ?? [])
      .filter((l) => (l.org_id as string) === orgId)
      .map((l) => ({ id: l.id as string, name: l.name as string, city: l.city as string }));
    if (m.role === "merchant_staff") locations = locations.filter((l) => m.seatLocationIds.has(l.id));
    result.push({
      org_id: orgId,
      name: org.name as string,
      lane: org.lane as string,
      role: m.role,
      tier: org.tier as string,
      status: org.status as string,
      locations,
    });
  }
  // Owned orgs first, then alphabetical — a stable, predictable switcher order.
  result.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "merchant_owner" ? -1 : 1));
  return result;
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

  // Every location must resolve to a known city, or clout earned here would join
  // no leaderboard. A miss is a create-time error the merchant can act on.
  const cityId = await resolveCityId(geo.lat, geo.lng);
  if (cityId === null) {
    throw new ApiError("VALIDATION_ERROR", "This address is not within a supported city.", {
      address: [{ path: "city", message: "no_city_within_range" }],
    });
  }

  const { data, error } = await getServiceClient()
    .from("locations")
    .insert({ org_id: org.id, ...clean, lat: geo.lat, lng: geo.lng, city_id: cityId })
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
    // The address moved, so re-resolve the city. A move out of every supported
    // city is a rejected edit, not a silently orphaned location.
    const cityId = await resolveCityId(geo.lat, geo.lng);
    if (cityId === null) {
      throw new ApiError("VALIDATION_ERROR", "This address is not within a supported city.", {
        address: [{ path: "city", message: "no_city_within_range" }],
      });
    }
    update.city_id = cityId;
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
  handle: string;
  display_name: string;
  location_id: string;
  granted_at: string;
}

export async function addStaff(orgId: string, grantedBy: string, toHandle: string, locationId: string): Promise<StaffSeat> {
  // The location must belong to this org — a seat is scoped to one location.
  const loc = await getLocation(locationId);
  if (loc.org_id !== orgId) {
    throw new ApiError("VALIDATION_ERROR", "That location does not belong to this organization.", {
      body: [{ path: "location_id", message: "wrong org" }],
    });
  }
  // Resolved on the handle, the platform's one recipient-identity primitive
  // (the transfer send flow does the same). No client ever handles a user_id.
  const recipient = await getUserByHandle(toHandle);
  if (!recipient) {
    throw new ApiError("NOT_FOUND", "No account with that handle.", { body: [{ path: "to_handle", message: "unknown" }] });
  }
  const { error } = await getServiceClient()
    .from("user_roles")
    .insert({ user_id: recipient.id, role: "merchant_staff", org_id: orgId, location_id: locationId, granted_by: grantedBy });
  if (error) {
    if (error.code === "23505") throw new ApiError("VALIDATION_ERROR", "That account already has a role in this organization.");
    if (error.code === "23503") throw new ApiError("NOT_FOUND", "No such user.");
    throw new Error(`add staff failed: ${error.message}`);
  }
  return {
    user_id: recipient.id, handle: recipient.handle, display_name: recipient.full_name,
    location_id: locationId, granted_at: new Date().toISOString(),
  };
}

export async function listStaff(orgId: string): Promise<StaffSeat[]> {
  // Join the account leaf so the owner sees handles, not raw ids — the id is an
  // internal handle no operator ever reads.
  const { data, error } = await getServiceClient()
    .from("user_roles")
    .select("user_id, location_id, granted_at, users:user_id(handle, full_name)")
    .eq("org_id", orgId)
    .eq("role", "merchant_staff")
    .order("granted_at", { ascending: true });
  if (error) throw new Error(`list staff failed: ${error.message}`);
  return (data ?? []).map((row) => {
    const u = (row as { users: { handle: string; full_name: string } | { handle: string; full_name: string }[] | null }).users;
    const acct = Array.isArray(u) ? u[0] : u;
    return {
      user_id: row.user_id as string,
      handle: acct?.handle ?? "unknown",
      display_name: acct?.full_name ?? "",
      location_id: row.location_id as string,
      granted_at: row.granted_at as string,
    };
  });
}
