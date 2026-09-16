import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { catchDrop, listCatches } from "@/lib/catches";

/**
 * API-CONTRACT §5: the catch. The single most important endpoint in the system.
 *
 * The route enforces the pre-flight gates in order — auth and suspension (auth
 * "user"), the location hard gate, and the mandatory Idempotency-Key — then
 * hands off to the catch contract (lib/catches.ts), which owns the atomic Redis
 * DECR, position derivation, code minting, and the follow-up Postgres write.
 * The contract decides DROP_GONE from Redis alone, with no database round trip.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/catches",
    operationId: "createCatch",
    summary: "Catch a drop",
    tags: ["Catches"],
    auth: "user",
    request: { body: z.object({ drop_id: z.uuid() }) },
    response: {
      status: 201,
      data: z.object({
        catch_id: z.string(),
        position_number: z.number(),
        code: z.string(),
        expires_at: z.string(),
        drop: z.object({ id: z.string(), title: z.string() }),
      }),
    },
    errors: ["LOCATION_PERMISSION_REQUIRED", "PHONE_UNVERIFIED", "DROP_GONE", "DROP_NOT_LIVE", "ALREADY_CAUGHT", "NOT_FOUND"],
  },
  async ({ body, request, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");

    // SMS verification is a hard gate on taking inventory (PRD §3.4): an
    // unverified account cannot catch, so it cannot take a unit or transfer it.
    // Clout-only enforcement is not enough — the inventory itself is the target.
    if (user.phone_verified_at === null) {
      throw new ApiError("PHONE_UNVERIFIED", "Verify your phone number to catch.");
    }

    // Location is the hard gate (PRD §7.4). Denied/never-granted cannot catch.
    if (user.location_perm_granted_at === null) {
      throw new ApiError("LOCATION_PERMISSION_REQUIRED", "Location permission is required to catch.");
    }

    // Idempotency-Key is mandatory: a dropped response must not consume a unit.
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError("VALIDATION_ERROR", "Idempotency-Key header is required.", {
        headers: [{ path: "Idempotency-Key", message: "required" }],
      });
    }

    const result = await catchDrop(user.id, body.drop_id, idempotencyKey);
    return {
      data: {
        catch_id: result.catch_id,
        position_number: result.position_number,
        code: result.code,
        expires_at: result.expires_at,
        drop: result.drop,
      },
    };
  },
);

export const POST = route.handler;

/**
 * API-CONTRACT §5: the wallet. The caller's catches (as current holder), newest
 * first, optionally filtered by status. The Send tab reads `?status=held`.
 */
const listRoute = defineRoute(
  {
    method: "get",
    path: "/v1/catches",
    operationId: "listCatches",
    summary: "The wallet — the caller's catches",
    tags: ["Catches"],
    auth: "user",
    request: {
      query: z.object({
        status: z.enum(["held", "transfer_pending", "redeemed", "expired"]).optional(),
      }),
    },
    response: {
      data: z.array(
        z.object({
          id: z.string(),
          status: z.string(),
          position_number: z.number(),
          code: z.string(),
          transfer_count: z.number(),
          caught_at: z.string(),
          expires_at: z.string(),
          drop: z.object({ id: z.string(), title: z.string() }),
        }),
      ),
    },
  },
  async ({ query, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await listCatches(user.id, query.status) };
  },
);

export const GET = listRoute.handler;
