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
 * Optional observer of every DECR, for load-test instrumentation only (records
 * timestamps to measure achieved concurrency). Never set in production.
 */
let decrObserver: ((dropId: string, at: number) => void) | undefined;
export function setDecrObserver(fn: ((dropId: string, at: number) => void) | undefined): void {
  decrObserver = fn;
}

/**
 * Atomic DECR. Returns the counter's value after the decrement. A value below
 * zero is Gone: the caller rejects immediately with no database round trip
 * and no re-increment.
 */
export async function decrementInventory(dropId: string): Promise<number> {
  decrObserver?.(dropId, Date.now());
  return redis().decr(inventoryKey(dropId));
}

/** Read the current inventory value without decrementing (reconciliation). */
export async function readInventory(dropId: string): Promise<number | null> {
  const v = await redis().get<number>(inventoryKey(dropId));
  return v ?? null;
}

// ---------------------------------------------------------------------------
// Drop meta, seeded at go-live so the catch hot path never reads Postgres:
// quantity_total (for position math), the live-window close time, and the
// redemption window + title for the response. A Gone decision is then purely
// Redis: read meta, DECR, reject on < 0 — zero DB round trip.
// ---------------------------------------------------------------------------
export interface DropMeta {
  qt: number; // quantity_total
  lu: number | null; // live_until epoch millis (catch window close)
  ru: string | null; // redeem_until ISO (catch expires_at)
  title: string;
  code: string; // the drop's redemption code (one per drop, PRD §7.3)
}

const metaKey = (dropId: string) => `drop:${dropId}:meta`;

export async function seedDropMeta(dropId: string, meta: DropMeta): Promise<void> {
  await redis().set(metaKey(dropId), meta);
}

export async function getDropMeta(dropId: string): Promise<DropMeta | null> {
  return (await redis().get<DropMeta>(metaKey(dropId))) ?? null;
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

/**
 * Dev-only SMS observability. The dev SMS sender records every message it
 * "sends" into a short-lived, capped Redis list keyed by recipient, so an
 * out-of-process gate (which cannot see the server's memory) can prove that a
 * transfer SMS was sent regardless of the recipient's notification prefs. The
 * production (Twilio) sender never calls this. Best-effort: a Redis hiccup must
 * never break an actual send.
 */
export const devSmsKey = (to: string): string => `dev:sms:${to}`;

export async function recordDevSms(to: string, body: string): Promise<void> {
  try {
    const key = devSmsKey(to);
    await redis().lpush(key, JSON.stringify({ to, body, at: new Date().toISOString() }));
    await redis().ltrim(key, 0, 49);
    await redis().expire(key, 3600);
  } catch {
    /* observability only; never fail a send on it */
  }
}

/** Readiness probe. Throws if Redis does not answer PING. */
export async function pingRedis(): Promise<void> {
  const reply = await redis().ping();
  if (reply !== "PONG") {
    throw new Error(`Redis PING returned ${String(reply)}`);
  }
}

// ---------------------------------------------------------------------------
// Generic short-lived state. Used by phone verification, OAuth state/PKCE,
// and per-actor rate counters. Everything here carries a TTL: nothing set
// through these helpers can outlive its window.
// ---------------------------------------------------------------------------

/** Store a JSON value with a TTL (seconds). Overwrites. */
export async function kvSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  await redis().set(key, value, { ex: ttlSeconds });
}

/** Read a JSON value, or null if absent/expired. */
export async function kvGet<T>(key: string): Promise<T | null> {
  return (await redis().get<T>(key)) ?? null;
}

/** Delete a key (single-use consumption). */
export async function kvDel(key: string): Promise<void> {
  await redis().del(key);
}

/**
 * Increment a counter, setting its TTL on first use only. Returns the new
 * count. The window does not slide: the first hit starts the clock and later
 * hits within it do not extend it. Used for rate limits (SMS send, etc.).
 */
export async function incrementWithWindow(
  key: string,
  windowSeconds: number,
): Promise<number> {
  const count = await redis().incr(key);
  if (count === 1) {
    await redis().expire(key, windowSeconds);
  }
  return count;
}
