import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/admin/audit";
import type { AdminActor } from "@/lib/admin/actor";

/**
 * Admin org management (API-CONTRACT §11). Limits are stored on the org row and
 * set to arbitrary values here (Enterprise); nothing derives a limit from the
 * tier enum. Every mutation writes the audit trail with before and after.
 */

const ADMIN_ORG_COLUMNS =
  "id, name, lane, status, tier, max_locations, drops_per_cycle, drops_pooled_org_level, cycle_anchor_at, created_at";

export interface AdminOrg {
  id: string; name: string; lane: string; status: string; tier: string;
  max_locations: number; drops_per_cycle: number; drops_pooled_org_level: boolean;
  cycle_anchor_at: string; created_at: string;
}

export async function listOrgsAdmin(opts: { status?: string; limit?: number } = {}): Promise<AdminOrg[]> {
  let q = getServiceClient().from("organizations").select(ADMIN_ORG_COLUMNS).order("created_at", { ascending: false }).limit(opts.limit ?? 200);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(`list orgs failed: ${error.message}`);
  return (data ?? []) as AdminOrg[];
}

async function loadOrg(orgId: string): Promise<AdminOrg> {
  const { data, error } = await getServiceClient().from("organizations").select(ADMIN_ORG_COLUMNS).eq("id", orgId).maybeSingle();
  if (error) throw new Error(`load org failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such organization.");
  return data as AdminOrg;
}

export interface AdminOrgPatch {
  tier?: string;
  max_locations?: number;
  drops_per_cycle?: number;
  drops_pooled_org_level?: boolean;
  status?: "active" | "past_due" | "suspended" | "delisted" | "cancelled";
}

export async function patchOrgAdmin(actor: AdminActor, orgId: string, patch: AdminOrgPatch): Promise<AdminOrg> {
  const before = await loadOrg(orgId);
  const update: Record<string, unknown> = {};
  if (patch.tier !== undefined) update.tier = patch.tier;
  if (patch.max_locations !== undefined) update.max_locations = patch.max_locations;
  if (patch.drops_per_cycle !== undefined) update.drops_per_cycle = patch.drops_per_cycle;
  if (patch.drops_pooled_org_level !== undefined) update.drops_pooled_org_level = patch.drops_pooled_org_level;
  if (patch.status !== undefined) update.status = patch.status;
  if (Object.keys(update).length === 0) return before;

  const { data, error } = await getServiceClient().from("organizations").update(update).eq("id", orgId).select(ADMIN_ORG_COLUMNS).single();
  if (error) throw new Error(`update org failed: ${error.message}`);
  const after = data as AdminOrg;
  await writeAudit({ actorId: actor.actorId, action: "org.update", targetType: "organization", targetId: orgId, before, after, ip: actor.ip });
  return after;
}

async function setOrgStatus(actor: AdminActor, orgId: string, status: "suspended" | "delisted", action: string): Promise<AdminOrg> {
  const before = await loadOrg(orgId);
  const { data, error } = await getServiceClient().from("organizations").update({ status }).eq("id", orgId).select(ADMIN_ORG_COLUMNS).single();
  if (error) throw new Error(`${action} failed: ${error.message}`);
  const after = data as AdminOrg;
  await writeAudit({ actorId: actor.actorId, action, targetType: "organization", targetId: orgId, before, after, ip: actor.ip });
  return after;
}

/** Suspend an org: it stops operating. Drops already live are untouched by this. */
export function suspendOrg(actor: AdminActor, orgId: string): Promise<AdminOrg> {
  return setOrgStatus(actor, orgId, "suspended", "org.suspend");
}

/** Delist an org: removed from discovery. Gone drops remain reachable (invariant #11). */
export function delistOrg(actor: AdminActor, orgId: string): Promise<AdminOrg> {
  return setOrgStatus(actor, orgId, "delisted", "org.delist");
}
