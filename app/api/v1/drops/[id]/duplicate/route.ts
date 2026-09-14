import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { dropResponseSchema } from "@/lib/api/drop-schemas";
import { duplicateDrop } from "@/lib/drops";
import { orgIdForDrop, requireOwner } from "@/lib/auth/org-access";

/** Duplicate any drop to a new draft (all fields editable). Owner/admin only. */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/drops/{id}/duplicate",
    operationId: "duplicateDrop",
    summary: "Duplicate a drop",
    description: "Clones to a new draft; consumes allowance only when scheduled.",
    tags: ["Drops"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: { status: 201, data: dropResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForDrop(params.id));
    return { data: await duplicateDrop(params.id, user.id) };
  },
);

export const POST = route.handler;
