import { ApiError } from "@/lib/api/errors";
import { sanitizeText } from "@/lib/sanitize";
import { getServiceClient } from "@/lib/supabase/server";
import { getGeocoder, type AddressParts } from "@/lib/geo/geocoder";

/**
 * Address CRUD with server-side geocoding, per-address radius, Home protection,
 * and active-address fallback. Address governs discovery; it is never consulted
 * at redemption (invariant #10, §8.2). The client never supplies lat/lng.
 */

export interface AddressRow {
  id: string;
  user_id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  lat: number | null;
  lng: number | null;
  radius_miles: number;
  is_home: boolean;
  formatted_address: string | null;
  geo_location_type: string | null;
  geocoded_at: string | null;
  created_at: string;
}

export const ADDRESS_COLUMNS =
  "id, user_id, label, line1, line2, city, region, postal_code, country, lat, lng, radius_miles, is_home, formatted_address, geo_location_type, geocoded_at, created_at";

const LINE_FIELDS = ["line1", "line2", "city", "region", "postal_code", "country"] as const;

export interface AddressCreateInput {
  label: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postal_code: string;
  country?: string | null;
  radius_miles?: number;
}

export interface AddressPatchInput {
  label?: string;
  line1?: string;
  line2?: string | null;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string | null;
  radius_miles?: number;
}

function partsOf(row: {
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postal_code: string;
  country?: string | null;
}): AddressParts {
  return {
    line1: row.line1,
    line2: row.line2 ?? null,
    city: row.city,
    region: row.region,
    postal_code: row.postal_code,
    country: row.country ?? "US",
  };
}

export async function listAddresses(userId: string): Promise<AddressRow[]> {
  const { data, error } = await getServiceClient()
    .from("addresses")
    .select(ADDRESS_COLUMNS)
    .eq("user_id", userId)
    .order("is_home", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`list addresses failed: ${error.message}`);
  return (data ?? []) as AddressRow[];
}

async function getOwnedAddress(userId: string, id: string): Promise<AddressRow> {
  const { data, error } = await getServiceClient()
    .from("addresses")
    .select(ADDRESS_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`load address failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such address.");
  return data as AddressRow;
}

export async function createAddress(
  userId: string,
  input: AddressCreateInput,
): Promise<AddressRow> {
  const clean = {
    label: sanitizeText(input.label, 80),
    line1: sanitizeText(input.line1, 200),
    line2: input.line2 ? sanitizeText(input.line2, 200) : null,
    city: sanitizeText(input.city, 120),
    region: sanitizeText(input.region, 80),
    postal_code: sanitizeText(input.postal_code, 20),
    country: input.country ? sanitizeText(input.country, 2) : "US",
    radius_miles: input.radius_miles ?? 10,
  };

  const geo = await getGeocoder().geocode(partsOf(clean));

  const { data, error } = await getServiceClient()
    .from("addresses")
    .insert({
      user_id: userId,
      label: clean.label,
      line1: clean.line1,
      line2: clean.line2,
      city: clean.city,
      region: clean.region,
      postal_code: clean.postal_code,
      country: clean.country,
      radius_miles: clean.radius_miles,
      is_home: false, // Home is created only at registration
      lat: geo.lat,
      lng: geo.lng,
      formatted_address: geo.formatted_address,
      geo_location_type: geo.location_type,
      geocoded_at: new Date().toISOString(),
    })
    .select(ADDRESS_COLUMNS)
    .single();
  if (error) throw new Error(`create address failed: ${error.message}`);
  return data as AddressRow;
}

export async function updateAddress(
  userId: string,
  id: string,
  patch: AddressPatchInput,
): Promise<AddressRow> {
  const existing = await getOwnedAddress(userId, id);

  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) update.label = sanitizeText(patch.label, 80);
  if (patch.line1 !== undefined) update.line1 = sanitizeText(patch.line1, 200);
  if (patch.line2 !== undefined) update.line2 = patch.line2 ? sanitizeText(patch.line2, 200) : null;
  if (patch.city !== undefined) update.city = sanitizeText(patch.city, 120);
  if (patch.region !== undefined) update.region = sanitizeText(patch.region, 80);
  if (patch.postal_code !== undefined) update.postal_code = sanitizeText(patch.postal_code, 20);
  if (patch.country !== undefined) update.country = patch.country ? sanitizeText(patch.country, 2) : "US";
  if (patch.radius_miles !== undefined) update.radius_miles = patch.radius_miles;

  // Re-geocode ONLY when a line of the address itself changed. A label- or
  // radius-only edit must not trigger a lookup (permanent cache).
  const lineChanged = LINE_FIELDS.some(
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
    const geo = await getGeocoder().geocode(partsOf(merged));
    update.lat = geo.lat;
    update.lng = geo.lng;
    update.formatted_address = geo.formatted_address;
    update.geo_location_type = geo.location_type;
    update.geocoded_at = new Date().toISOString();
  }

  if (Object.keys(update).length === 0) return existing;

  const { data, error } = await getServiceClient()
    .from("addresses")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select(ADDRESS_COLUMNS)
    .single();
  if (error) throw new Error(`update address failed: ${error.message}`);
  return data as AddressRow;
}

/**
 * Delete an address. Home is undeletable. Deleting the active address falls
 * back to Home so a user is never left with no active market.
 */
export async function deleteAddress(userId: string, id: string): Promise<{ active_address_id: string | null }> {
  const svc = getServiceClient();
  const existing = await getOwnedAddress(userId, id);
  if (existing.is_home) {
    throw new ApiError("VALIDATION_ERROR", "Home address cannot be deleted.", {
      address: [{ path: "is_home", message: "home is undeletable" }],
    });
  }

  const { data: userRow, error: userErr } = await svc
    .from("users")
    .select("active_address_id")
    .eq("id", userId)
    .single();
  if (userErr) throw new Error(`load user failed: ${userErr.message}`);

  let activeAfter = userRow.active_address_id as string | null;
  if (activeAfter === id) {
    const { data: home, error: homeErr } = await svc
      .from("addresses")
      .select("id")
      .eq("user_id", userId)
      .eq("is_home", true)
      .maybeSingle();
    if (homeErr) throw new Error(`load home failed: ${homeErr.message}`);
    activeAfter = (home?.id as string | undefined) ?? null;
    const { error: setErr } = await svc
      .from("users")
      .update({ active_address_id: activeAfter, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (setErr) throw new Error(`fallback active address failed: ${setErr.message}`);
  }

  const { error: delErr } = await svc.from("addresses").delete().eq("id", id).eq("user_id", userId);
  if (delErr) throw new Error(`delete address failed: ${delErr.message}`);
  return { active_address_id: activeAfter };
}

export async function setActiveAddress(userId: string, addressId: string): Promise<void> {
  await getOwnedAddress(userId, addressId); // 404 if not owned
  const { error } = await getServiceClient()
    .from("users")
    .update({ active_address_id: addressId, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(`set active address failed: ${error.message}`);
}
