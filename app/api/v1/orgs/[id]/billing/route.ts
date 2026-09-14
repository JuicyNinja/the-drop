import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { billingResponseSchema } from "@/lib/api/org-schemas";
import { getOrg, countActiveLocations } from "@/lib/orgs";
import { currentCycle } from "@/lib/billing/allowance";
import { requireOwner } from "@/lib/auth/org-access";

/** Billing summary: stored limits, current cycle, active locations. Owner/admin only. */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/orgs/{id}/billing",
    operationId: "getOrgBilling",
    summary: "Org billing summary",
    tags: ["Merchant"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: { data: billingResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, params.id);
    const org = await getOrg(params.id);
    return {
      data: {
        tier: org.tier,
        max_locations: org.max_locations,
        drops_per_cycle: org.drops_per_cycle,
        drops_pooled_org_level: org.drops_pooled_org_level,
        active_locations: await countActiveLocations(org.id),
        cycle: currentCycle(org.cycle_anchor_at),
      },
    };
  },
);

export const GET = route.handler;
