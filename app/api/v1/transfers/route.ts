import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { createTransfer } from "@/lib/transfers";

/**
 * API-CONTRACT §7: send a catch to another buyer. One hop, a 5-minute accept
 * window, and a 30-minute pre-close send cutoff — all server-authoritative. The
 * recipient is notified by SMS regardless of their follow tier or SMS pref.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/transfers",
    operationId: "createTransfer",
    summary: "Send a catch to another buyer",
    tags: ["Transfers"],
    auth: "user",
    request: { body: z.object({ catch_id: z.uuid(), to_handle: z.string().min(1).max(40) }) },
    response: {
      status: 201,
      data: z.object({
        transfer_id: z.string(),
        to_handle: z.string(),
        status: z.string(),
        accept_by: z.string(),
      }),
    },
    errors: ["TRANSFER_LIMIT_REACHED", "TRANSFER_CUTOFF_PASSED", "NOT_FOUND"],
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await createTransfer(user.id, body.catch_id, body.to_handle) };
  },
);

export const POST = route.handler;
