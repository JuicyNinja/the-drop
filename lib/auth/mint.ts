import { ApiError } from "@/lib/api/errors";
import { getAnonClient, getServiceClient } from "@/lib/supabase/server";

/**
 * Session issuance and refresh.
 *
 * Our session IS a Supabase Auth session (same JWT web and native). Once the
 * identity provider has established an email, we find-or-create the Auth user
 * and mint a session for it. Refresh is delegated to GoTrue, which has
 * refresh-token rotation and reuse detection enabled (supabase/config.toml):
 * every refresh returns a new token and a replayed token past the reuse
 * interval revokes the whole family.
 */

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number | null;
  token_type: string;
}

export interface MintedSession {
  session: Session;
  authUserId: string;
  email: string;
}

function toSession(s: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
}): Session {
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_in: s.expires_in ?? 0,
    expires_at: s.expires_at ?? null,
    token_type: s.token_type ?? "bearer",
  };
}

/** Find-or-create the Auth user for `email` and mint a fresh session. */
export async function mintSessionForEmail(email: string): Promise<MintedSession> {
  const admin = getServiceClient();

  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created.error && !/already/i.test(created.error.message)) {
    throw new Error(`createUser failed: ${created.error.message}`);
  }

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.properties?.email_otp) {
    throw new Error(`generateLink failed: ${link.error?.message ?? "no otp"}`);
  }

  const verified = await getAnonClient().auth.verifyOtp({
    email,
    token: link.data.properties.email_otp,
    type: "email",
  });
  if (verified.error || !verified.data.session || !verified.data.user) {
    throw new Error(`verifyOtp failed: ${verified.error?.message ?? "no session"}`);
  }

  return {
    session: toSession(verified.data.session),
    authUserId: verified.data.user.id,
    email,
  };
}

/** Rotate a refresh token via GoTrue. A stale/invalid token is UNAUTHENTICATED. */
export async function refreshSession(refreshToken: string): Promise<Session> {
  const { data, error } = await getAnonClient().auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (error || !data.session) {
    throw new ApiError("UNAUTHENTICATED", "Refresh token is invalid or has been used.");
  }
  return toSession(data.session);
}
