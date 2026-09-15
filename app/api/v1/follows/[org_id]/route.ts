import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { setFollowTier, unfollow } from "@/lib/follows";

/**
 * API-CONTRACT §8: set or clear the CALLER's follow tier for an org. Fanatic is
 * opt-in only and self-initiated — the caller sets their OWN tier. There is no
 * merchant-initiated path to promote a user (grep-verified). An 11th Fanatic in
 * a lane returns FANATIC_LIMIT_REACHED with the lane's current Fanatics for a swap.
 */
const put = defineRoute(
  {
    method: "put",
    path: "/v1/follows/{org_id}",
    operationId: "setFollow",
    summary: "Set the caller's follow tier for an org",
    tags: ["Follows"],
    auth: "user",
    request: {
      params: z.object({ org_id: z.uuid() }),
      body: z.object({ tier: z.enum(["follower", "fanatic"]) }),
    },
    response: {
      data: z.object({ org_id: z.string(), name: z.string(), lane: z.string(), tier: z.string() }),
    },
    errors: ["FANATIC_LIMIT_REACHED", "NOT_FOUND"],
  },
  async ({ params, body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await setFollowTier(user.id, params.org_id, body.tier) };
  },
);

const del = defineRoute(
  {
    method: "delete",
    path: "/v1/follows/{org_id}",
    operationId: "unfollow",
    summary: "Unfollow an org (frees a Fanatic slot immediately)",
    tags: ["Follows"],
    auth: "user",
    request: { params: z.object({ org_id: z.uuid() }) },
    response: { data: z.object({ ok: z.boolean() }) },
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await unfollow(user.id, params.org_id);
    return { data: { ok: true } };
  },
);

export const PUT = put.handler;
export const DELETE = del.handler;
