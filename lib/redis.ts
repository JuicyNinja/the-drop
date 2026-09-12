import { Redis } from "@upstash/redis";
import { getEnv } from "@/lib/env";

/**
 * The only module that touches Redis.
 *
 * Provider: Upstash Redis over REST (`@upstash/redis`). On Vercel's serverless
 * runtime a TCP client opens a connection per invocation; at drop-open that
 * is a connection storm in exactly the moment the product cannot fail. The
 * REST client is stateless and has no pool to exhaust.
 *
 * Two hard requirements, both of which WP-7 depends on:
 *
 * 1. `decrementInventory` is one atomic DECR round trip. No read-then-write,
 *    no Lua wrapper, no client-side optimistic locking.
 * 2. `claimIdempotencyKey` is one operation: SET key value NX EX 86400. Never
 *    SETNX followed by EXPIRE. The two-call form leaves keys without a TTL
 *    when the second call fails.
 *
 * No route handler imports `@upstash/redis` directly. If the provider ever
 * changes, this file changes and nothing else does.
 */

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const IDEMPOTENCY_PENDING = "__pending__";

let client: Redis | undefined;

function redis(): Redis {
  if (!client) {
    const env = getEnv();
    client = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return client;
}

/** Test hook only. */
export function resetRedisClient(): void {
  client = undefined;
}

export const inventoryKey = (dropId: string): string =>
  `drop:${dropId}:inventory`;

export const idempotencyKeyFor = (key: string): string => `idem:${key}`;

/**
 * Seed a drop's inventory at go-live. SET NX: if the key already exists the
 * call is a no-op and returns false. Inventory is never re-seeded upward.
 * Counters never go up (CLAUDE.md invariant #2).
 */
export async function seedInventory(
  dropId: string,
  quantityTotal: number,
): Promise<boolean> {
  const result = await redis().set(inventoryKey(dropId), quantityTotal, {
    nx: true,
  });
  return result === "OK";
}

/**
 * Atomic DECR. Returns the counter's value after the decrement. A value below
 * zero is Gone: the caller rejects immediately with no database round trip
 * and no re-increment. Position derivation from this value belongs to WP-7.
 */
export async function decrementInventory(dropId: string): Promise<number> {
  return redis().decr(inventoryKey(dropId));
}

/**
 * Claim an Idempotency-Key. One operation, SET NX EX, so the key can never
 * exist without a TTL. Returns true when this call won the claim, false when
 * the key was already held (a retry).
 */
export async function claimIdempotencyKey(key: string): Promise<boolean> {
  const result = await redis().set(
    idempotencyKeyFor(key),
    IDEMPOTENCY_PENDING,
    { nx: true, ex: IDEMPOTENCY_TTL_SECONDS },
  );
  return result === "OK";
}

/**
 * Store the response for a claimed key so a retry returns the original
 * response, including the original position number. XX + KEEPTTL: only
 * overwrites a claimed key and never extends the 24h window.
 */
export async function storeIdempotencyResult<T>(
  key: string,
  result: T,
): Promise<void> {
  await redis().set(idempotencyKeyFor(key), result, {
    xx: true,
    keepTtl: true,
  });
}

/**
 * The stored response for a key, `null` if the key is unknown, and
 * `"pending"` if it is claimed but the original request has not finished.
 */
export async function getIdempotencyResult<T>(
  key: string,
): Promise<T | "pending" | null> {
  const value = await redis().get<T | typeof IDEMPOTENCY_PENDING>(
    idempotencyKeyFor(key),
  );
  if (value === null || value === undefined) return null;
  if (value === IDEMPOTENCY_PENDING) return "pending";
  return value;
}

/** Readiness probe. Throws if Redis does not answer PING. */
export async function pingRedis(): Promise<void> {
  const reply = await redis().ping();
  if (reply !== "PONG") {
    throw new Error(`Redis PING returned ${String(reply)}`);
  }
}
