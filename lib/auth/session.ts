import { ApiError } from "@/lib/api/errors";
import { getAnonClient } from "@/lib/supabase/server";
import { getUserById, type UserRecord } from "@/lib/users";

/**
 * Bearer-token authentication for route handlers.
 *
 * The access token is a Supabase Auth JWT (same token web and native). It is
 * verified against GoTrue, which is authoritative. The web client holds this
 * token in memory only and re-obtains it via the refresh token; see the
 * security notes in API-CONTRACT §2.
 */

export interface AuthedIdentity {
  authUserId: string;
  email: string | null;
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    throw new ApiError("UNAUTHENTICATED", "Missing or malformed bearer token.");
  }
  return match[1];
}

/** Valid Supabase JWT required. Does not require a completed users row. */
export async function verifySession(request: Request): Promise<AuthedIdentity> {
  const token = bearerToken(request);
  const { data, error } = await getAnonClient().auth.getUser(token);
  if (error || !data.user) {
    throw new ApiError("UNAUTHENTICATED", "Invalid or expired token.");
  }
  return { authUserId: data.user.id, email: data.user.email ?? null };
}

/**
 * Valid JWT AND a completed, active users row. A JWT without a users row is
 * treated as unauthenticated: identity is established but registration is not
 * complete, so no user-scoped capability is reachable yet. A suspended
 * account is ACCOUNT_SUSPENDED.
 */
export async function requireUser(request: Request): Promise<UserRecord> {
  const identity = await verifySession(request);
  const user = await getUserById(identity.authUserId);
  if (!user || user.deleted_at !== null) {
    throw new ApiError(
      "UNAUTHENTICATED",
      "Registration is not complete for this account.",
    );
  }
  if (user.suspended_at !== null) {
    throw new ApiError("ACCOUNT_SUSPENDED", "This account is suspended.", {
      reason: user.suspension_reason,
    });
  }
  return user;
}
