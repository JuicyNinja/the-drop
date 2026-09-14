import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { listIncoming } from "@/lib/transfers";

/**
 * API-CONTRACT §7: the recipient's pending incoming transfers, each with the
 * time it returns to the sender. Self-scoped (to_user_id = caller), so it is not
 * an enumeration surface.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/transfers/incoming",
    operationId: "listIncomingTransfers",
    summary: "Pending transfers addressed to the caller",
    tags: ["Transfers"],
    auth: "user",
    response: {
      data: z.array(
        z.object({
          id: z.string(),
          from_handle: z.string(),
          position_number: z.number(),
          drop_title: z.string(),
          accept_by: z.string(),
          sent_at: z.string(),
        }),
      ),
    },
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await listIncoming(user.id) };
  },
);

export const GET = route.handler;
