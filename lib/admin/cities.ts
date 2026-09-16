import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/admin/audit";
import type { AdminActor } from "@/lib/admin/actor";

/**
 * Admin city configuration (API-CONTRACT §11): geofence radius, the cold-start
 * window (days) and event threshold, the IANA timezone (WP-12 — the digest
 * resolves each user's local hour against it), and launch. Launching a market is
 * flipping `active` true and stamping `launched_at`; the cold-start window is
 * measured from that instant. Audited.
 */

const CITY_COLUMNS =
  "id, name, region, country, lat, lng, timezone, default_geofence_m, coldstart_days, coldstart_min_events, active, launched_at";

export interface AdminCity {
  id: string; name: string; region: string; country: string; lat: number; lng: number;
  timezone: string; default_geofence_m: number; coldstart_days: number; coldstart_min_events: number;
  active: boolean; launched_at: string | null;
}

export async function listCitiesAdmin(): Promise<AdminCity[]> {
  const { data, error } = await getServiceClient().from("cities").select(CITY_COLUMNS).order("name", { ascending: true });
  if (error) throw new Error(`list cities failed: ${error.message}`);
  return (data ?? []) as AdminCity[];
}

async function loadCity(cityId: string): Promise<AdminCity> {
  const { data, error } = await getServiceClient().from("cities").select(CITY_COLUMNS).eq("id", cityId).maybeSingle();
  if (error) throw new Error(`load city failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such city.");
  return data as AdminCity;
}

export interface CreateCityInput {
  name: string; region: string; country?: string; lat: number; lng: number;
  timezone?: string; default_geofence_m?: number; coldstart_days?: number; coldstart_min_events?: number;
}

export async function createCityAdmin(actor: AdminActor, input: CreateCityInput): Promise<AdminCity> {
  const row = {
    name: input.name, region: input.region, country: input.country ?? "US",
    lat: input.lat, lng: input.lng, timezone: input.timezone ?? "America/Denver",
    default_geofence_m: input.default_geofence_m ?? 150,
    coldstart_days: input.coldstart_days ?? 30,
    coldstart_min_events: input.coldstart_min_events ?? 500,
    active: false, // a city launches via a deliberate PATCH, never at creation
  };
  const { data, error } = await getServiceClient().from("cities").insert(row).select(CITY_COLUMNS).single();
  if (error) throw new Error(`create city failed: ${error.message}`);
  const after = data as AdminCity;
  await writeAudit({ actorId: actor.actorId, action: "city.create", targetType: "city", targetId: after.id, before: null, after, ip: actor.ip });
  return after;
}

export interface CityPatch {
  name?: string; region?: string; timezone?: string;
  default_geofence_m?: number; coldstart_days?: number; coldstart_min_events?: number;
  active?: boolean;
}

export async function patchCityAdmin(actor: AdminActor, cityId: string, patch: CityPatch): Promise<AdminCity> {
  const before = await loadCity(cityId);
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.region !== undefined) update.region = patch.region;
  if (patch.timezone !== undefined) update.timezone = patch.timezone;
  if (patch.default_geofence_m !== undefined) update.default_geofence_m = patch.default_geofence_m;
  if (patch.coldstart_days !== undefined) update.coldstart_days = patch.coldstart_days;
  if (patch.coldstart_min_events !== undefined) update.coldstart_min_events = patch.coldstart_min_events;
  if (patch.active !== undefined) {
    update.active = patch.active;
    // Launching stamps launched_at once; the cold-start window runs from here.
    if (patch.active && before.launched_at === null) update.launched_at = new Date().toISOString();
  }
  if (Object.keys(update).length === 0) return before;

  const action = patch.active === true && before.launched_at === null ? "city.launch" : "city.update";
  const { data, error } = await getServiceClient().from("cities").update(update).eq("id", cityId).select(CITY_COLUMNS).single();
  if (error) throw new Error(`update city failed: ${error.message}`);
  const after = data as AdminCity;
  await writeAudit({ actorId: actor.actorId, action, targetType: "city", targetId: cityId, before, after, ip: actor.ip });
  return after;
}
