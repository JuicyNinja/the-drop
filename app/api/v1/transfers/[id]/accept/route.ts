import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { acceptTransfer } from "@/lib/transfers";

/**
 * API-CONTRACT §7: accept an incoming transfer. Moves catches.user_id to the
 * caller and marks the one hop used. Position travels; clout does not (clout is
 * written only on redemption, to whoever redeems).
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/transfers/{id}/accept",
    operationId: "acceptTransfer",
    summary: "Accept an incoming transfer",
    tags: ["Transfers"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: {
      data: z.object({
        transfer_id: z.string(),
        status: z.string(),
        catch_id: z.string(),
        position_number: z.number(),
      }),
    },
    errors: ["TRANSFER_EXPIRED", "NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await acceptTransfer(user.id, params.id) };
  },
);

export const POST = route.handler;
