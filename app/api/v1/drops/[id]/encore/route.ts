import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { dropResponseSchema } from "@/lib/api/drop-schemas";
import { encoreDrop } from "@/lib/drops";
import { orgIdForDrop, requireOwner } from "@/lib/auth/org-access";

/**
 * Encore: the only mechanism for adding supply. Available only from `gone`.
 * Creates a new linked drop with parent_drop_id set; the parent's quantity is
 * never touched. There is no restock path anywhere. Owner/admin only.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/drops/{id}/encore",
    operationId: "encoreDrop",
    summary: "Encore a Gone drop",
    tags: ["Drops"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: { status: 201, data: dropResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForDrop(params.id));
    return { data: await encoreDrop(params.id, user.id) };
  },
);

export const POST = route.handler;
