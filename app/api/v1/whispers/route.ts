import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { createWhisper } from "@/lib/whispers";

/**
 * API-CONTRACT §9: submit a whisper — private post-redemption feedback anchored
 * on "would you return at full price". One per redemption; earns clout. Only the
 * redemption's own buyer may whisper it (enforced in lib/whispers).
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/whispers",
    operationId: "createWhisper",
    summary: "Submit a whisper",
    tags: ["Clout"],
    auth: "user",
    request: {
      body: z.object({
        redemption_id: z.uuid(),
        would_return_at_full_price: z.boolean(),
        dim_2: z.number().int().min(1).max(5),
        dim_3: z.number().int().min(1).max(5),
        dim_4: z.number().int().min(1).max(5),
        note: z.string().max(2000).optional(),
      }),
    },
    response: {
      status: 201,
      data: z.object({ id: z.string(), clout_earned: z.number() }),
    },
    errors: ["NOT_FOUND"],
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await createWhisper(user.id, body) };
  },
);

export const POST = route.handler;
