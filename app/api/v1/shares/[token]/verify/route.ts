import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { verifyReturn } from "@/lib/shares";

/**
 * API-CONTRACT §9: a verified return click. The authenticated user who returned
 * through the share link confirms the return; the SHARER earns clout, once,
 * only if the returner is not the sharer and the link has not already been
 * attributed. This is the sole clout path for a share — an unreturned share
 * earns nothing.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/shares/{token}/verify",
    operationId: "verifyShareReturn",
    summary: "Attribute a verified return click",
    tags: ["Clout"],
    auth: "user",
    request: { params: z.object({ token: z.string().min(8).max(80) }) },
    response: {
      data: z.object({
        attributed: z.boolean(),
        reason: z.enum(["self", "already_verified"]).optional(),
        clout_earned: z.number().optional(),
      }),
    },
    errors: ["NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await verifyReturn(user.id, params.token) };
  },
);

export const POST = route.handler;
