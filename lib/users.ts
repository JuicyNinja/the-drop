import { getServiceClient } from "@/lib/supabase/server";

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
 * PostgREST returns bigint as a JSON number. user_number is the public identity
 * and always travels as a string (bare digits; zero-padded to 14 only for
 * display), so it is coerced here at the single read boundary.
 */
export function normalizeUserRow(row: Record<string, unknown>): UserRecord {
  return { ...(row as unknown as UserRecord), user_number: String(row.user_number) };
}
