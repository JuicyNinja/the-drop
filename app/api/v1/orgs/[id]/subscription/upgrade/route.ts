import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { upgradeSchema } from "@/lib/api/drop-schemas";
import { getOrg } from "@/lib/orgs";
import { requireOwner } from "@/lib/auth/org-access";
import { upgradeSubscription } from "@/lib/billing/upgrade";

/**
 * The one-click prorated upgrade behind the soft block. Prorated and applied
 * instantly: the org's stored limits are recomputed from the target tier and
 * scheduling is unblocked in the same request. Idempotency-Key is mandatory so
 * a double-clicked button neither charges twice nor double-applies. Owner/admin.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/orgs/{id}/subscription/upgrade",
    operationId: "upgradeSubscription",
    summary: "Upgrade subscription (prorated, instant)",
    tags: ["Merchant"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }), body: upgradeSchema },
    response: {
      data: z.object({
        subscription_id: z.string(),
        charged_cents: z.number(),
        new_tier: z.string(),
        limits: z.object({
          max_locations: z.number(),
          drops_per_cycle: z.number(),
          drops_pooled_org_level: z.boolean(),
        }),
        cycle_ends_at: z.string(),
      }),
    },
    errors: ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR", "RATE_LIMITED"],
  },
  async ({ params, body, request, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, params.id);

    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError("VALIDATION_ERROR", "Idempotency-Key header is required.", {
        headers: [{ path: "Idempotency-Key", message: "required" }],
      });
    }
    const org = await getOrg(params.id);
    return { data: await upgradeSubscription(org, body.target_tier, idempotencyKey) };
  },
);

export const POST = route.handler;
