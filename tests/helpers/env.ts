import { vi } from "vitest";
import { resetEnvCache } from "@/lib/env";

/** A syntactically valid environment. Values are placeholders, not credentials. */
export const VALID_ENV: Record<string, string | undefined> = {
  APP_ENV: "local",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-placeholder",
  UPSTASH_REDIS_REST_URL: "https://placeholder.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token-placeholder",
  APP_URL: "http://127.0.0.1:3000",
};

/** Stub process.env for a test and clear the cached parse. */
export function stubValidEnv(overrides: Record<string, string> = {}): void {
  resetEnvCache();
  for (const [key, value] of Object.entries({ ...VALID_ENV, ...overrides })) {
    vi.stubEnv(key, value ?? "");
  }
}
