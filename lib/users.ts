import { getServiceClient } from "@/lib/supabase/server";
import { normalizeHandle } from "@/lib/handles";

/**
 * The application user row (public.users), distinct from the Supabase Auth
 * user. `id` equals the auth uid; `user_number` and `handle` are the public
 * identity. The auth uid is never surfaced to clients.
 */
export interface UserRecord {
  id: string;
  user_number: string; // bigint, returned as string; zero-pad to 14 on DISPLAY only
  handle: string;
  handle_changed_at: string | null;
  full_name: string;
  email: string;
  email_verified_at: string | null;
  phone: string;
  phone_verified_at: string | null;
  active_address_id: string | null;
  location_perm_granted_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  deleted_at: string | null;
  walkthrough_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const USER_COLUMNS =
  "id, user_number, handle, handle_changed_at, full_name, email, email_verified_at, phone, phone_verified_at, active_address_id, location_perm_granted_at, suspended_at, suspension_reason, deleted_at, walkthrough_completed_at, created_at, updated_at";

/** The user_number, zero-padded to 14 digits. Display only; never stored. */
export function formatUserNumber(userNumber: string | number | bigint): string {
  return String(userNumber).padStart(14, "0");
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const { data, error } = await getServiceClient()
    .from("users")
    .select(USER_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`load user failed: ${error.message}`);
  return data ? normalizeUserRow(data) : null;
}

/**
 * Resolve a user by the confusable-collapsed form of a handle (the same
 * uniqueness key registration enforces), so a transfer to `t_a_d` reaches the
 * account registered as `tad`. Returns null when no live account matches. Only
 * the fields a transfer needs; never the auth uid or address graph.
 */
export async function getUserByHandle(
  handle: string,
): Promise<{ id: string; handle: string; full_name: string; phone: string } | null> {
  const { data, error } = await getServiceClient()
    .from("users")
    .select("id, handle, full_name, phone")
    .eq("handle_normalized", normalizeHandle(handle))
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`handle lookup failed: ${error.message}`);
  return data
    ? {
        id: data.id as string,
        handle: data.handle as string,
        full_name: data.full_name as string,
        phone: data.phone as string,
      }
    : null;
}

/**
 * Prefix autocomplete over handles for the transfer send flow (API-CONTRACT §7).
 * Returns ONLY the public leaf of the user graph — handle and display name —
 * never the user number, city, phone, or email. The caller is excluded (you
 * cannot send a catch to yourself). This is a user-enumeration surface; the
 * route in front of it enforces a minimum query length and a hard per-user rate
 * limit, which together are what stop namespace sweeping at volume. Prefix match
 * on the raw handle (not the normalized form) so the results read naturally.
 */
export async function searchHandles(
  q: string,
  excludeUserId: string,
  limit = 10,
): Promise<{ handle: string; display_name: string }[]> {
  // Escape PostgREST/ILIKE metacharacters so a query cannot widen the match.
  const prefix = q.toLowerCase().replace(/[%_\\,()]/g, "");
  if (prefix.length === 0) return [];
  const { data, error } = await getServiceClient()
    .from("users")
    .select("handle, full_name")
    .ilike("handle", `${prefix}%`)
    .is("deleted_at", null)
    .neq("id", excludeUserId)
    .order("handle", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`handle search failed: ${error.message}`);
  return (data ?? []).map((r) => ({ handle: r.handle as string, display_name: r.full_name as string }));
}

/**
 * PostgREST returns bigint as a JSON number. user_number is the public identity
 * and always travels as a string (bare digits; zero-padded to 14 only for
 * display), so it is coerced here at the single read boundary.
 */
export function normalizeUserRow(row: Record<string, unknown>): UserRecord {
  return { ...(row as unknown as UserRecord), user_number: String(row.user_number) };
}
