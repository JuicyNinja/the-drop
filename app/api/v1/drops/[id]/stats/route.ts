import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { orgIdForDrop, requireOwner } from "@/lib/auth/org-access";

/**
 * Per-drop stats. WP-5 ships the role gate: owner/admin only, merchant_staff
 * rejected with 403. The metrics themselves (catches, redemptions, whispers)
 * are WP-13, so an authorized caller gets NOT_IMPLEMENTED (501). The v1 release
 * gate greps for any surviving NOT_IMPLEMENTED.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/drops/{id}/stats",
    operationId: "getDropStats",
    summary: "Per-drop stats",
    description: "Role gate is live (WP-5); the metrics are WP-13.",
    tags: ["Drops"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: { data: z.object({ drop_id: z.string() }) },
    errors: ["FORBIDDEN", "NOT_FOUND", "NOT_IMPLEMENTED"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForDrop(params.id));
    throw new ApiError("NOT_IMPLEMENTED", "Drop stats are not built yet.", {
      pending_work_package: "WP-13",
    });
  },
);

export const GET = route.handler;
