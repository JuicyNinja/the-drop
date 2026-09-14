import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { declineTransfer } from "@/lib/transfers";

/**
 * API-CONTRACT §7: decline an incoming transfer. The catch returns to the
 * original holder immediately, never to the inventory pool.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/transfers/{id}/decline",
    operationId: "declineTransfer",
    summary: "Decline an incoming transfer",
    tags: ["Transfers"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: {
      data: z.object({ transfer_id: z.string(), status: z.string() }),
    },
    errors: ["TRANSFER_EXPIRED", "NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await declineTransfer(user.id, params.id) };
  },
);

export const POST = route.handler;
