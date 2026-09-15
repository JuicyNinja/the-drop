import { ApiError } from "@/lib/api/errors";
import { normalizeHandle, validateHandle } from "@/lib/handles";
import { sanitizeText } from "@/lib/sanitize";
import { getServiceClient } from "@/lib/supabase/server";
import { getUserById, normalizeUserRow, type UserRecord } from "@/lib/users";
import { getGeocoder } from "@/lib/geo/geocoder";
import { resolveTimezone } from "@/lib/cities";

/**
 * Registration completion: turns an authenticated identity (email from OAuth)
 * into a full users row plus Home address and buyer role. The rest of the
 * profile (preference tags, more addresses, Fanatics) is deferred to the
 * post-registration email prompt, not a signup blocker (PRD §3.5).
 */

export interface AddressInput {
  label: string;
  line1: string;
  line2?: string | null;
  city: string;
  region: string;
  postal_code: string;
  country?: string | null;
}

export interface RegistrationInput {
  full_name: string;
  handle: string;
  phone: string;
  address: AddressInput;
}

export interface RegistrationStatus {
  registration_complete: boolean;
  missing_fields: string[];
}

/** Whether the authenticated account has completed registration. */
export async function registrationStatus(authUserId: string): Promise<RegistrationStatus> {
  const user = await getUserById(authUserId);
  if (user && user.deleted_at === null) {
    return { registration_complete: true, missing_fields: [] };
  }
  return { registration_complete: false, missing_fields: ["handle", "phone", "address"] };
}

/** Reject reserved handles as HANDLE_TAKEN, never revealing that they are special. */
export async function assertHandleAvailable(handle: string): Promise<void> {
  const normalized = normalizeHandle(handle);
  const svc = getServiceClient();

  const reserved = await svc
    .from("reserved_handles")
    .select("handle")
    .filter("handle", "not.is", null);
  // Compare on the normalized form. The reserved table is small (a few hundred
  // rows) and read once at registration, so a client-side match is fine and
  // keeps the normalization in exactly one place (lib/handles.ts).
  if (reserved.error) throw new Error(`reserved lookup failed: ${reserved.error.message}`);
  if ((reserved.data ?? []).some((r) => normalizeHandle(r.handle as string) === normalized)) {
    throw new ApiError("HANDLE_TAKEN", "That handle is not available.");
  }

  const existing = await svc
    .from("users")
    .select("id")
    .eq("handle_normalized", normalized)
    .maybeSingle();
  if (existing.error) throw new Error(`handle lookup failed: ${existing.error.message}`);
  if (existing.data) throw new ApiError("HANDLE_TAKEN", "That handle is not available.");
}

function requiredText(value: string, field: string, max = 200): string {
  const clean = sanitizeText(value, max);
  if (clean.length === 0) {
    throw new ApiError("VALIDATION_ERROR", `Invalid ${field}.`, {
      body: [{ path: field, message: "required" }],
    });
  }
  return clean;
}

export async function completeRegistration(
  authUserId: string,
  email: string,
  input: RegistrationInput,
): Promise<UserRecord> {
  const validated = validateHandle(input.handle);
  if (!validated.ok) {
    throw new ApiError("VALIDATION_ERROR", validated.problem.message, {
      body: [{ path: "handle", message: validated.problem.rule }],
    });
  }
  const handle = validated.handle;

  await assertHandleAvailable(handle);

  const fullName = requiredText(input.full_name, "full_name");
  const addr = input.address;
  const label = requiredText(addr.label, "address.label", 80);
  const line1 = requiredText(addr.line1, "address.line1");
  const city = requiredText(addr.city, "address.city", 120);
  const region = requiredText(addr.region, "address.region", 80);
  const postal = requiredText(addr.postal_code, "address.postal_code", 20);
  const line2 = addr.line2 ? sanitizeText(addr.line2, 200) : "";
  const country = addr.country ? sanitizeText(addr.country, 2) : "US";

  // Geocode the Home address server-side before creating anything: a bad
  // address fails here rather than seeding a coordinate-less Home.
  const geo = await getGeocoder().geocode({
    line1,
    line2: line2 || null,
    city,
    region,
    postal_code: postal,
    country,
  });

  const svc = getServiceClient();
  const { data, error } = await svc.rpc("app_complete_registration", {
    p_user_id: authUserId,
    p_handle: handle,
    p_full_name: fullName,
    p_email: email,
    p_phone: input.phone,
    p_label: label,
    p_line1: line1,
    p_line2: line2,
    p_city: city,
    p_region: region,
    p_postal: postal,
    p_country: country,
  });

  if (error) {
    // Backstop for a race that beat the pre-check to the unique index.
    if (error.code === "23505") {
      if (/handle/i.test(error.message)) {
        throw new ApiError("HANDLE_TAKEN", "That handle is not available.");
      }
      throw new ApiError("VALIDATION_ERROR", "This account is already registered.", {
        body: [{ path: "", message: "duplicate" }],
      });
    }
    throw new Error(`registration failed: ${error.message}`);
  }

  const user = normalizeUserRow(data as Record<string, unknown>);

  // Store the geocode on the just-created Home address.
  if (user.active_address_id) {
    const { error: geoErr } = await svc
      .from("addresses")
      .update({
        lat: geo.lat,
        lng: geo.lng,
        formatted_address: geo.formatted_address,
        geo_location_type: geo.location_type,
        geocoded_at: new Date().toISOString(),
      })
      .eq("id", user.active_address_id);
    if (geoErr) throw new Error(`home geocode store failed: ${geoErr.message}`);
  }

  // Default the user's timezone from the Home city (WP-12): the daily digest
  // schedules against the user's LOCAL hour, DST-correct. Best-effort — a
  // registration never fails on it; the digest falls back to the active
  // address's city timezone when this is null.
  const tz = await resolveTimezone(geo.lat, geo.lng);
  if (tz) {
    const { error: tzErr } = await svc.from("users").update({ timezone: tz }).eq("id", user.id);
    if (tzErr) console.error(`[registration] timezone default failed for ${user.id}`, tzErr.message);
  }

  return user;
}
