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
 * Guard against two definitions claiming the same method and path. A
 * duplicate is a bug in the route tree, not something to merge silently.
 */
export function claimRoute(method: string, path: string): void {
  const key = `${method.toUpperCase()} ${path}`;
  if (registered.has(key)) {
    throw new Error(`Route already defined: ${key}`);
  }
  registered.add(key);
}
