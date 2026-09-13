import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

/**
 * The single OpenAPI registry. Every `defineRoute` call registers into it;
 * `lib/api/openapi.ts` turns it into `openapi.json`, the native contract.
 */

export const registry = new OpenAPIRegistry();

/** API-CONTRACT §1.1: Supabase Auth JWT, same token for web and native. */
export const BEARER_AUTH = "bearerAuth";

registry.registerComponent("securitySchemes", BEARER_AUTH, {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "Supabase Auth JWT. Same token for web and native.",
});

const registered = new Set<string>();

/**
 * Claim a method+path. Returns true when the caller should register into the
 * OpenAPI registry, false when it should skip (an already-claimed route).
 *
 * A genuine double-definition is a bug in the route tree, so outside the Next
 * server runtime — the OpenAPI generator and vitest, where each route file is
 * imported exactly once — a re-claim throws. Inside `next dev`, hot-reload
 * re-evaluates a route module against the surviving registry; there a re-claim
 * is expected and simply skips re-registration.
 */
export function claimRoute(method: string, path: string): boolean {
  const key = `${method.toUpperCase()} ${path}`;
  if (registered.has(key)) {
    if (process.env.NEXT_RUNTIME) return false; // HMR re-evaluation
    throw new Error(`Route already defined: ${key}`);
  }
  registered.add(key);
  return true;
}
