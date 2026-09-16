import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/admin/audit";
import { formatUserNumber } from "@/lib/users";
import type { AdminActor } from "@/lib/admin/actor";

/**
 * Admin buyer/user management (API-CONTRACT §11): suspend and clout-freeze, both
 * reversible (a suspend with no reinstatement is a support problem), both
 * audited. There is NO clout grant path — freeze only stops accrual; it never
 * adds or removes earned clout (invariant #6).
 */

const ADMIN_USER_COLUMNS =
  "id, user_number, handle, full_name, email, suspended_at, clout_frozen_at, deleted_at, created_at";

export interface AdminUser {
  id: string; user_number: string; user_number_display: string; handle: string;
  full_name: string; email: string;
  suspended_at: string | null; clout_frozen_at: string | null; deleted_at: string | null;
  created_at: string;
}

function toAdminUser(d: Record<string, unknown>): AdminUser {
  return {
    id: d.id as string,
    user_number: String(d.user_number),
    user_number_display: formatUserNumber(String(d.user_number)),
    handle: d.handle as string,
    full_name: d.full_name as string,
    email: d.email as string,
    suspended_at: (d.suspended_at as string | null) ?? null,
    clout_frozen_at: (d.clout_frozen_at as string | null) ?? null,
    deleted_at: (d.deleted_at as string | null) ?? null,
    created_at: d.created_at as string,
  };
}

export async function listUsersAdmin(opts: { q?: string; limit?: number } = {}): Promise<AdminUser[]> {
  let query = getServiceClient().from("users").select(ADMIN_USER_COLUMNS).order("created_at", { ascending: false }).limit(opts.limit ?? 100);
  if (opts.q && opts.q.trim()) {
    const term = opts.q.trim();
    query = query.or(`handle.ilike.%${term}%,full_name.ilike.%${term}%,email.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`list users failed: ${error.message}`);
  return (data ?? []).map((d) => toAdminUser(d as Record<string, unknown>));
}

async function loadUser(userId: string): Promise<AdminUser> {
  const { data, error } = await getServiceClient().from("users").select(ADMIN_USER_COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw new Error(`load user failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such user.");
  return toAdminUser(data as Record<string, unknown>);
}

/** Suspend (or reinstate) a buyer. Sets suspended_at; auth `user` routes reject a
 *  suspended account, so this blocks catching, redeeming, and transferring. */
export async function setUserSuspended(actor: AdminActor, userId: string, suspended: boolean): Promise<AdminUser> {
  const before = await loadUser(userId);
  const { data, error } = await getServiceClient()
    .from("users")
    .update({ suspended_at: suspended ? new Date().toISOString() : null })
    .eq("id", userId).select(ADMIN_USER_COLUMNS).single();
  if (error) throw new Error(`suspend user failed: ${error.message}`);
  const after = toAdminUser(data as Record<string, unknown>);
  await writeAudit({ actorId: actor.actorId, action: suspended ? "user.suspend" : "user.reinstate", targetType: "user", targetId: userId, before, after, ip: actor.ip });
  return after;
}

/** Freeze (or unfreeze) clout accrual. The recompute ignores the user's events
 *  dated on/after the freeze; the ledger is untouched. Reversible. */
export async function setCloutFrozen(actor: AdminActor, userId: string, frozen: boolean): Promise<AdminUser> {
  const before = await loadUser(userId);
  const { data, error } = await getServiceClient()
    .from("users")
    .update({ clout_frozen_at: frozen ? new Date().toISOString() : null })
    .eq("id", userId).select(ADMIN_USER_COLUMNS).single();
  if (error) throw new Error(`clout freeze failed: ${error.message}`);
  const after = toAdminUser(data as Record<string, unknown>);
  await writeAudit({ actorId: actor.actorId, action: frozen ? "user.clout_freeze" : "user.clout_unfreeze", targetType: "user", targetId: userId, before, after, ip: actor.ip });
  return after;
}
