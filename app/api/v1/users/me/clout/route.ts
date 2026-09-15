import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { getCloutView } from "@/lib/clout";

/**
 * API-CONTRACT §9: the caller's clout for their strongest city, with recent
 * ledger events. There is NO write endpoint for clout — not here, not for admin.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/users/me/clout",
    operationId: "getMyClout",
    summary: "The caller's clout standing",
    tags: ["Clout"],
    auth: "user",
    response: {
      data: z.object({
        city_id: z.string().nullable(),
        tier: z.number(),
        percentile: z.number().nullable(),
        decayed_score: z.number(),
        recent_events: z.array(
          z.object({ source: z.string(), points: z.number(), occurred_at: z.string() }),
        ),
      }),
    },
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await getCloutView(user.id) };
  },
);

export const GET = route.handler;
