import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { createDropSchema, dropResponseSchema } from "@/lib/api/drop-schemas";
import { createDraft, scheduleDrop } from "@/lib/drops";
import { orgIdForLocation, requireOwner } from "@/lib/auth/org-access";

/**
 * Create a Local drop. Begins from a location (the client flow enters from the
 * business profile, never a bare form). Owner/admin only; staff is 403.
 *
 * A draft consumes no allowance. `publish: true` schedules immediately, which
 * consumes allowance and can return 402 ALLOWANCE_EXHAUSTED (the soft block) —
 * the draft is kept so the merchant can upgrade and publish it.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/drops",
    operationId: "createDrop",
    summary: "Create a drop",
    description: "Local drop, created from a location. draft by default; publish:true schedules it.",
    tags: ["Drops"],
    auth: "user",
    request: { body: createDropSchema },
    response: { status: 201, data: dropResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND", "ALLOWANCE_EXHAUSTED", "VALIDATION_ERROR"],
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForLocation(body.location_id));

    const draft = await createDraft(user.id, body);
    if (body.publish) {
      // Schedule now; a 402 here leaves the draft for upgrade-and-publish.
      return { data: await scheduleDrop(draft.id) };
    }
    return { data: draft };
  },
);

export const POST = route.handler;
