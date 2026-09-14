import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { dropResponseSchema, patchDropSchema } from "@/lib/api/drop-schemas";
import { cancelDrop, getDrop, patchDraft, scheduleDrop } from "@/lib/drops";
import { orgIdForDrop, requireOwner } from "@/lib/auth/org-access";

/**
 * Edit or transition a drop. Owner/admin only.
 *   status: "scheduled" → schedule (consumes allowance; 402 at cap)
 *   status: "draft"     → cancel back to draft (allowance NOT restored)
 *   field edits         → allowed on draft/scheduled; a live drop is
 *                         DROP_IMMUTABLE (enforced by DB trigger).
 */
const route = defineRoute(
  {
    method: "patch",
    path: "/v1/drops/{id}",
    operationId: "patchDrop",
    summary: "Edit or schedule a drop",
    tags: ["Drops"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }), body: patchDropSchema },
    response: { data: dropResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND", "DROP_IMMUTABLE", "ALLOWANCE_EXHAUSTED", "VALIDATION_ERROR"],
  },
  async ({ params, body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForDrop(params.id));

    const { status, ...fields } = body;

    if (Object.keys(fields).length > 0) {
      await patchDraft(params.id, fields);
    }
    if (status === "scheduled") return { data: await scheduleDrop(params.id) };
    if (status === "draft") return { data: await cancelDrop(params.id) };
    return { data: await getDrop(params.id) };
  },
);

export const PATCH = route.handler;
