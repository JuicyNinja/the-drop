/**
 * Runs once when a Next.js server instance starts, before it serves requests.
 * Validating the environment here means a missing variable fails at boot with
 * its name, not at the first request that happens to need it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("@/lib/env");
    getEnv();
  }
}
