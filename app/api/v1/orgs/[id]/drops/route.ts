import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireOwner } from "@/lib/auth/org-access";
import { listOrgDrops } from "@/lib/operator";

/**
 * The operator Drops list. Owner/admin only. Newest first; every status (draft
 * through gone), so the operator can duplicate, edit, or open stats on any drop.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/orgs/{id}/drops",
    operationId: "listOrgDrops",
    summary: "An org's drops (operator list)",
    tags: ["Merchant"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: {
      data: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string(),
          terms: z.string().nullable(),
          status: z.string(),
          quantity_total: z.number(),
          quantity_remaining: z.number(),
          price_cents: z.number().nullable(),
          live_at: z.string().nullable(),
          live_until: z.string().nullable(),
          redeem_from: z.string().nullable(),
          redeem_until: z.string().nullable(),
          redeem_days: z.array(z.number()).nullable(),
          redeem_time_start: z.string().nullable(),
          redeem_time_end: z.string().nullable(),
          location_id: z.string().nullable(),
        }),
      ),
    },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, params.id);
    return { data: await listOrgDrops(params.id) };
  },
);

export const GET = route.handler;
