import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api/errors";
import {
  claimIdempotencyKey,
  decrementInventory,
  getDropMeta,
  getIdempotencyResult,
  readInventory,
  storeIdempotencyResult,
} from "@/lib/redis";
import { getServiceClient } from "@/lib/supabase/server";
import { formatRedeemWindow, type RedeemWindow } from "@/lib/window";

/**
 * THE CATCH CONTRACT (CLAUDE.md §1). Drop-open is a thundering herd; this is
 * the one place a subtle bug is invisible in testing and catastrophic in
 * production. Rules that must not be "simplified":
 *
 *  - Inventory is Redis. DECR is atomic and returns the position. A value
 *    below zero is Gone — reject immediately, NO database round trip, NO
 *    re-increment.
 *  - Idempotency-Key is claimed in Redis (SET NX EX 24h) BEFORE the DECR, so a
 *    retry never consumes a second unit. A replay returns the original result.
 *  - The Postgres write follows the (already committed) Redis decision. A
 *    failed write BURNS the position number; the gap is correct and the number
 *    is never reused (DECR only ever decreases).
 *  - Position = quantity_total - post_decrement_value. First catch → 1.
 *  - The code is the DROP's code (one per drop, PRD §7.3), carried onto the
 *    catch from Redis meta — not minted per catch.
 */

const IDEMPOTENCY_POLL_MS = 50;
const IDEMPOTENCY_POLL_TRIES = 100; // ~5s for a concurrent in-flight original

export interface CatchSuccess {
  kind: "ok";
  catch_id: string;
  position_number: number;
  code: string;
  expires_at: string;
  drop: { id: string; title: string };
}
interface CatchFailure {
  kind: "error";
  code: string; // ErrorCode
  message: string;
}
type StoredCatch = CatchSuccess | CatchFailure;

function replay(stored: StoredCatch): CatchSuccess {
  if (stored.kind === "ok") return stored;
  throw new ApiError(stored.code as never, stored.message);
}

/**
 * Execute a catch. `originalUserId` is the authenticated buyer (the route has
 * already enforced auth, suspension, and the location gate). `idempotencyKey`
 * is mandatory (the route rejects its absence).
 */
export async function catchDrop(
  originalUserId: string,
  dropId: string,
  idempotencyKey: string,
): Promise<CatchSuccess> {
  // 1. Meta from Redis (no DB). Absent → the drop is not live-seeded; only
  //    then do we touch Postgres, to distinguish NOT_FOUND from DROP_NOT_LIVE.
  const meta = await getDropMeta(dropId);
  if (!meta) {
    const { data, error } = await getServiceClient().from("drops").select("status").eq("id", dropId).maybeSingle();
    if (error) throw new Error(`load drop failed: ${error.message}`);
    if (!data) throw new ApiError("NOT_FOUND", "No such drop.");
    throw new ApiError("DROP_NOT_LIVE", "This drop is not live.");
  }

  // 2. Catch window (Redis only).
  if (meta.lu !== null && Date.now() > meta.lu) {
    throw new ApiError("DROP_NOT_LIVE", "This drop's window has closed.");
  }

  // 3. Idempotency claim BEFORE the DECR.
  const claimed = await claimIdempotencyKey(idempotencyKey);
  if (!claimed) {
    for (let i = 0; i < IDEMPOTENCY_POLL_TRIES; i++) {
      const prior = await getIdempotencyResult<StoredCatch>(idempotencyKey);
      if (prior && prior !== "pending") return replay(prior);
      await new Promise((r) => setTimeout(r, IDEMPOTENCY_POLL_MS));
    }
    throw new ApiError("RATE_LIMITED", "A catch for this key is still in progress.");
  }

  // 4. The atomic scarcity decision.
  const remaining = await decrementInventory(dropId);
  if (remaining < 0) {
    // GONE. No DB round trip, no re-increment.
    const failure: CatchFailure = { kind: "error", code: "DROP_GONE", message: "This drop is Gone." };
    await storeIdempotencyResult(idempotencyKey, failure);
    throw new ApiError("DROP_GONE", failure.message);
  }

  // 5. Position, code, and the follow-up Postgres write. The code is the
  //    drop's code (same for every catcher), carried from meta.
  const position = meta.qt - remaining;
  const code = meta.code;
  const catchId = randomUUID();
  const expiresAt = meta.ru ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error } = await getServiceClient().from("catches").insert({
    id: catchId,
    drop_id: dropId,
    user_id: originalUserId,
    original_user_id: originalUserId,
    position_number: position,
    code,
    status: "held",
    expires_at: expiresAt,
  });

  if (error) {
    // The write failed → the position is BURNED (never reused; DECR does not
    // rewind). Store the outcome so a same-key replay is consistent.
    let apiError: ApiError;
    if (error.code === "23505" && /one_catch_per_buyer/i.test(error.message)) {
      apiError = new ApiError("ALREADY_CAUGHT", "You already caught this drop.");
    } else {
      apiError = new ApiError("INTERNAL_ERROR", "The catch could not be recorded.");
      console.error(`[catch] burned position ${position} on drop ${dropId}`, error.message);
    }
    await storeIdempotencyResult(idempotencyKey, { kind: "error", code: apiError.code, message: apiError.message });
    throw apiError;
  }

  const success: CatchSuccess = {
    kind: "ok",
    catch_id: catchId,
    position_number: position,
    code,
    expires_at: expiresAt,
    drop: { id: dropId, title: meta.title },
  };
  await storeIdempotencyResult(idempotencyKey, success);
  return success;
}

/**
 * The wallet (API-CONTRACT §5): the caller's catches, newest first, optionally
 * filtered by status. Scoped to the CURRENT holder (`user_id`), so an accepted
 * transfer appears in the recipient's wallet and leaves the sender's. Includes
 * the drop's code — the buyer owns it and types it at redemption — but only for
 * their own catches. The Send tab lists `status=held` to choose what to send.
 */
export interface WalletCatch {
  id: string;
  status: string;
  position_number: number;
  code: string;
  transfer_count: number;
  caught_at: string;
  expires_at: string;
  redeem_window: string; // full window in natural language, city-local (§4.4)
  drop: { id: string; title: string };
}

export type CatchStatusFilter = "held" | "transfer_pending" | "redeemed" | "expired";

export async function listCatches(
  userId: string,
  status?: CatchStatusFilter,
): Promise<WalletCatch[]> {
  let query = getServiceClient()
    .from("catches")
    .select("id, status, position_number, code, transfer_count, caught_at, expires_at, drops!inner(id, title, redeem_from, redeem_until, redeem_days, redeem_time_start, redeem_time_end, locations(cities(timezone)))")
    .eq("user_id", userId)
    .order("caught_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`list catches failed: ${error.message}`);
  return (data ?? []).map((r) => {
    const drop = r.drops as unknown as {
      id: string; title: string;
      redeem_from: string | null; redeem_until: string | null; redeem_days: number[] | null;
      redeem_time_start: string | null; redeem_time_end: string | null;
      locations: { cities: { timezone: string | null } | null } | null;
    };
    const tz = drop.locations?.cities?.timezone ?? "America/Denver";
    const win: RedeemWindow = {
      redeem_from: drop.redeem_from, redeem_until: drop.redeem_until, redeem_days: drop.redeem_days,
      redeem_time_start: drop.redeem_time_start, redeem_time_end: drop.redeem_time_end,
    };
    return {
      id: r.id as string,
      status: r.status as string,
      position_number: r.position_number as number,
      code: r.code as string,
      transfer_count: r.transfer_count as number,
      caught_at: r.caught_at as string,
      expires_at: r.expires_at as string,
      redeem_window: formatRedeemWindow(win, tz),
      drop: { id: drop.id, title: drop.title },
    };
  });
}

/**
 * Reconciliation (60s job). Compares quantity_total - count(catches) against
 * Redis inventory, logs drift, and writes quantity_remaining to Postgres for
 * the board. NEVER increases quantity_remaining, NEVER writes back to Redis.
 * The board's remaining tracks Redis (the true catchable count); burned
 * positions make it lower than quantity_total - count(catches), and that drift
 * is logged, not corrected.
 */
export interface ReconcileResult {
  drop_id: string;
  redis_inventory: number | null;
  catch_count: number;
  drift: number; // (quantity_total - catch_count) - redis_inventory = burned
  quantity_remaining_before: number;
  quantity_remaining_after: number;
}

export async function reconcileDrop(dropId: string): Promise<ReconcileResult> {
  const svc = getServiceClient();
  const { data: drop, error: dErr } = await svc.from("drops").select("quantity_total, quantity_remaining").eq("id", dropId).maybeSingle();
  if (dErr) throw new Error(`reconcile load failed: ${dErr.message}`);
  if (!drop) throw new ApiError("NOT_FOUND", "No such drop.");
  const qt = drop.quantity_total as number;
  const before = drop.quantity_remaining as number;

  const { count, error: cErr } = await svc.from("catches").select("id", { count: "exact", head: true }).eq("drop_id", dropId);
  if (cErr) throw new Error(`reconcile count failed: ${cErr.message}`);
  const catchCount = count ?? 0;

  const redisInv = await readInventory(dropId);
  // Target remaining = the Redis value clamped to [0, qt]; if Redis is unknown
  // (never seeded), fall back to qt - catchCount. DOWNWARD only.
  const target = redisInv === null ? qt - catchCount : Math.max(0, Math.min(qt, redisInv));
  const after = Math.min(before, target); // never increases

  if (after !== before) {
    const { error: uErr } = await svc.from("drops").update({ quantity_remaining: after, updated_at: new Date().toISOString() }).eq("id", dropId);
    if (uErr) throw new Error(`reconcile write failed: ${uErr.message}`);
  }

  const drift = redisInv === null ? 0 : qt - catchCount - redisInv;
  if (drift !== 0) console.warn(`[reconcile] drop ${dropId} drift=${drift} (burned positions)`);
  return { drop_id: dropId, redis_inventory: redisInv, catch_count: catchCount, drift, quantity_remaining_before: before, quantity_remaining_after: after };
}
