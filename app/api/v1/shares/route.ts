import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { createShare } from "@/lib/shares";

/**
 * API-CONTRACT §9: create a tracked share link. Returns a token + the public
 * /s/{token} URL. Clout is NOT earned here — only on a verified return click
 * (POST /v1/shares/{token}/verify).
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/shares",
    operationId: "createShare",
    summary: "Create a tracked share link",
    tags: ["Clout"],
    auth: "user",
    request: { body: z.object({ drop_id: z.uuid(), redemption_id: z.uuid().optional() }) },
    response: {
      status: 201,
      data: z.object({ token: z.string(), url: z.string() }),
    },
    errors: ["NOT_FOUND"],
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await createShare(user.id, body.drop_id, body.redemption_id ?? null) };
  },
);

export const POST = route.handler;
