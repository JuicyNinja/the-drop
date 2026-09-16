import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { orgIdForDrop, requireOwner } from "@/lib/auth/org-access";
import { getDropStats } from "@/lib/operator";

/**
 * Per-drop stats (WP-13). Owner/admin only (merchant_staff → 403). Real metrics:
 * catches, redemptions, the redemption rate, and the verified/unverified split.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/drops/{id}/stats",
    operationId: "getDropStats",
    summary: "Per-drop stats",
    tags: ["Drops"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: {
      data: z.object({
        drop_id: z.string(),
        status: z.string(),
        quantity_total: z.number(),
        quantity_remaining: z.number(),
        pct_remaining: z.number(),
        catches: z.number(),
        redemptions: z.number(),
        redemption_rate: z.number().nullable(),
        gps_verified: z.number(),
        unverified_timeout: z.number(),
      }),
    },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForDrop(params.id));
    return { data: await getDropStats(params.id) };
  },
);

export const GET = route.handler;
