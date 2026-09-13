import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

/**
 * Server-side Supabase access. Route handlers and jobs import from here.
 * Nothing under app/(ui)/** may (enforced by lint: the-drop/no-supabase-in-ui).
 *
 * The service-role client bypasses RLS. It exists for server-authoritative
 * writes only. It is never exposed to a browser and never used to answer a
 * request on a user's behalf without the handler enforcing authorization.
 */

let serviceClient: SupabaseClient | undefined;
let anonClient: SupabaseClient | undefined;

export function getServiceClient(): SupabaseClient {
  if (!serviceClient) {
    const env = getEnv();
    serviceClient = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return serviceClient;
}

/**
 * Anon-key client. Used for verifying a caller's access token and for
 * verifyOtp during dev session minting. Never used for privileged writes.
 */
export function getAnonClient(): SupabaseClient {
  if (!anonClient) {
    const env = getEnv();
    anonClient = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return anonClient;
}

/** Test hook only. */
export function resetSupabaseClient(): void {
  serviceClient = undefined;
  anonClient = undefined;
}

const PING_TIMEOUT_MS = 3000;

/**
 * Readiness probe. Hits the project's Auth health endpoint, which exists on
 * every Supabase project regardless of schema. Throws on non-2xx or timeout.
 */
export async function pingSupabase(): Promise<void> {
  const env = getEnv();
  const response = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`,
    {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`Supabase auth health returned HTTP ${response.status}`);
  }
}
