import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { redeem } from "@/lib/redemptions";

/**
 * API-CONTRACT §6: redeem a catch. The buyer types the drop's code into their
 * own device; the operator never calls this and no merchant-side redemption
 * route exists. The response is deliberately buyer-safe: it never reveals the
 * unverified flag (that lives only in the merchant feed and admin review).
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/redemptions",
    operationId: "createRedemption",
    summary: "Redeem a catch",
    tags: ["Redemptions"],
    auth: "user",
    request: {
      body: z.object({
        catch_id: z.uuid(),
        code: z.string().min(1).max(8),
        location: z
          .object({ lat: z.number(), lng: z.number(), accuracy_m: z.number() })
          .nullable()
          .optional(),
        gps_status: z.enum(["fix_acquired", "permission_denied", "no_fix_timeout"]),
      }),
    },
    response: {
      status: 201,
      data: z.object({
        redemption_id: z.string(),
        redeemed: z.literal(true),
        clout_earned: z.number(),
        whisper_prompt: z.literal(true),
      }),
    },
    errors: [
      "INVALID_CODE",
      "ALREADY_REDEEMED",
      "OUTSIDE_GEOFENCE",
      "GPS_ACCURACY_INSUFFICIENT",
      "REDEMPTION_WINDOW_CLOSED",
      "LOCATION_PERMISSION_REQUIRED",
      "RATE_LIMITED",
    ],
  },
  async ({ body, request, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    if (user.location_perm_granted_at === null) {
      throw new ApiError("LOCATION_PERMISSION_REQUIRED", "Location permission is required to redeem.");
    }
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError("VALIDATION_ERROR", "Idempotency-Key header is required.", {
        headers: [{ path: "Idempotency-Key", message: "required" }],
      });
    }
    const result = await redeem(user.id, body, idempotencyKey);
    return {
      data: {
        redemption_id: result.redemption_id,
        redeemed: result.redeemed,
        clout_earned: result.clout_earned,
        whisper_prompt: result.whisper_prompt,
      },
    };
  },
);

export const POST = route.handler;
