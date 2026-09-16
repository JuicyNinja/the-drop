import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireOwner } from "@/lib/auth/org-access";
import { getScoreboard } from "@/lib/operator";

/**
 * API-CONTRACT §10: the persistent top-right scoreboard. Owner/admin only. When
 * drops_pooled_org_level is true (Superstar, Enterprise) counts are org-wide —
 * the one place the billing model forks.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/orgs/{id}/scoreboard",
    operationId: "getScoreboard",
    summary: "The persistent operator scoreboard",
    tags: ["Merchant"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: {
      data: z.object({
        drops_used: z.number(),
        drops_remaining: z.number(),
        live_now: z.number(),
        total_catches: z.number(),
        total_redemptions: z.number(),
        whispers: z.number(),
        cycle_ends_at: z.string(),
        drops_pooled_org_level: z.boolean(),
      }),
    },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, params.id);
    return { data: await getScoreboard(params.id) };
  },
);

export const GET = route.handler;
