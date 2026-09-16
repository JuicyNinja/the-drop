import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { listTransferPatterns } from "@/lib/admin/fraud";

/** Transfer patterns (admin, read-only): one account receiving accepted transfers
 *  from many distinct senders — gate item 3. */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/admin/fraud/transfer-patterns",
    operationId: "adminTransferPatterns",
    summary: "Transfer patterns (admin)",
    tags: ["Admin"],
    auth: "user",
    response: {
      data: z.array(z.object({
        user_id: z.string(), user_handle: z.string(),
        distinct_senders: z.number(), transfers_received: z.number(),
      })),
    },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await listTransferPatterns() };
  },
);

export const GET = route.handler;
