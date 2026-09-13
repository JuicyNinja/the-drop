import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * API-CONTRACT §5: the catch. WP-3 builds the pre-flight chain in the
 * contract's exact order; the atomic Redis DECR, position derivation, code
 * minting, and async write are WP-7.
 *
 * The unbuilt step returns NOT_IMPLEMENTED (501), never INTERNAL_ERROR: a 501
 * that names the missing step is self-explanatory and cannot be confused with
 * a genuine 500 in a later package. The WP-7 gate asserts no NOT_IMPLEMENTED
 * remains here, and the v1 release gate greps the whole tree for it.
 *
 * Order (auth "user" already enforced UNAUTHENTICATED then ACCOUNT_SUSPENDED):
 *   LOCATION_PERMISSION_REQUIRED → Idempotency-Key → NOT_FOUND → DROP_NOT_LIVE
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/catches",
    operationId: "createCatch",
    summary: "Catch a drop",
    description: "Pre-flight validation is live in WP-3; the atomic catch is WP-7.",
    tags: ["Catches"],
    auth: "user",
    request: { body: z.object({ drop_id: z.uuid() }) },
    response: {
      data: z.object({
        catch_id: z.string(),
        position_number: z.number(),
        code: z.string(),
        expires_at: z.string(),
        drop: z.object({ id: z.string(), title: z.string() }),
      }),
    },
    errors: [
      "LOCATION_PERMISSION_REQUIRED",
      "DROP_GONE",
      "DROP_NOT_LIVE",
      "ALREADY_CAUGHT",
      "NOT_FOUND",
      "NOT_IMPLEMENTED",
    ],
  },
  async ({ body, request, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");

    // Location is the hard gate. Denied/never-granted cannot catch (PRD §7.4).
    if (user.location_perm_granted_at === null) {
      throw new ApiError(
        "LOCATION_PERMISSION_REQUIRED",
        "Location permission is required to catch.",
      );
    }

    // Idempotency-Key is mandatory: a dropped response must not consume a unit.
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError("VALIDATION_ERROR", "Idempotency-Key header is required.", {
        headers: [{ path: "Idempotency-Key", message: "required" }],
      });
    }

    const { data: drop, error } = await getServiceClient()
      .from("drops")
      .select("id, status")
      .eq("id", body.drop_id)
      .maybeSingle();
    if (error) throw new Error(`load drop failed: ${error.message}`);
    if (!drop) throw new ApiError("NOT_FOUND", "No such drop.");
    if (drop.status !== "live") {
      throw new ApiError("DROP_NOT_LIVE", "This drop is not live.");
    }

    // Everything past here — Redis DECR, position, code, async write — is WP-7.
    throw new ApiError(
      "NOT_IMPLEMENTED",
      "The catch contract (Redis inventory and position assignment) is not built yet.",
      { pending_work_package: "WP-7", step: "redis_decr_and_catch_write" },
    );
  },
);

export const POST = route.handler;
