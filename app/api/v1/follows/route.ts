import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { listFollows } from "@/lib/follows";

/**
 * API-CONTRACT §8: the caller's follows (org, lane, tier). Fanatic tier means
 * SMS + push (10 per lane); Follower means push + in-app (uncapped).
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/follows",
    operationId: "listFollows",
    summary: "The caller's follows",
    tags: ["Follows"],
    auth: "user",
    response: {
      data: z.array(z.object({ org_id: z.string(), name: z.string(), lane: z.string(), tier: z.string() })),
    },
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await listFollows(user.id) };
  },
);

export const GET = route.handler;
