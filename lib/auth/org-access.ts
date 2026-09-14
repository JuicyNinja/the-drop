import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";
import type { UserRecord } from "@/lib/users";

/**
 * Role-based access for merchant surfaces (PRD §3.2).
 *
 *   owner  — full access to the org: all locations, billing, drops, stats.
 *   staff  — scoped to ONE location; the only merchant surface they may reach
 *            is that location's Today's Code (WP-8). Everything else is 403.
 *   admin  — platform admin, full access.
 *
 * These are the server-side gates. The parallel RLS policies (is_admin,
 * is_org_owner) defend direct DB access; route handlers use the service client
 * and enforce authorization here.
 */

export type OrgRole = "admin" | "owner" | "staff" | null;

export async function getOrgRole(user: UserRecord, orgId: string): Promise<OrgRole> {
  const { data, error } = await getServiceClient()
    .from("user_roles")
    .select("role, org_id, location_id")
    .eq("user_id", user.id);
  if (error) throw new Error(`load roles failed: ${error.message}`);
  const roles = data ?? [];
  if (roles.some((r) => r.role === "admin")) return "admin";
  if (roles.some((r) => r.role === "merchant_owner" && r.org_id === orgId)) return "owner";
  if (roles.some((r) => r.role === "merchant_staff" && r.org_id === orgId)) return "staff";
  return null;
}

/** Owner or admin, else 403. Use on every owner-only surface. */
export async function requireOwner(user: UserRecord, orgId: string): Promise<void> {
  const role = await getOrgRole(user, orgId);
  if (role !== "owner" && role !== "admin") {
    throw new ApiError("FORBIDDEN", "Only the organization owner may do this.");
  }
}

export async function isAdmin(user: UserRecord): Promise<boolean> {
  const { data, error } = await getServiceClient()
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(`admin check failed: ${error.message}`);
  return Boolean(data);
}

/** Resolve the org that owns a drop, or throw NOT_FOUND. */
export async function orgIdForDrop(dropId: string): Promise<string> {
  const { data, error } = await getServiceClient()
    .from("drops")
    .select("org_id")
    .eq("id", dropId)
    .maybeSingle();
  if (error) throw new Error(`load drop failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such drop.");
  return data.org_id as string;
}

/** Resolve the org that owns a location, or throw NOT_FOUND. */
export async function orgIdForLocation(locationId: string): Promise<string> {
  const { data, error } = await getServiceClient()
    .from("locations")
    .select("org_id")
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw new Error(`load location failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such location.");
  return data.org_id as string;
}

/**
 * Access to a single location's merchant surfaces (Today's Code, code sheet).
 * Allowed for an admin, the owner of the location's org, or a staff member
 * scoped to THIS location. Today's Code is the only merchant surface staff may
 * reach (PRD §3.2, §10).
 */
export async function requireLocationAccess(user: UserRecord, locationId: string): Promise<void> {
  const orgId = await orgIdForLocation(locationId);
  const svc = getServiceClient();
  const { data, error } = await svc
    .from("user_roles")
    .select("role, org_id, location_id")
    .eq("user_id", user.id);
  if (error) throw new Error(`load roles failed: ${error.message}`);
  const roles = data ?? [];
  const ok =
    roles.some((r) => r.role === "admin") ||
    roles.some((r) => r.role === "merchant_owner" && r.org_id === orgId) ||
    roles.some((r) => r.role === "merchant_staff" && r.org_id === orgId && r.location_id === locationId);
  if (!ok) throw new ApiError("FORBIDDEN", "You do not have access to this location.");
}
