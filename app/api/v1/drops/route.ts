import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { orgIdForLocation, requireOwner } from "@/lib/auth/org-access";

/**
 * Create a drop. WP-5 ships the role gate only: owner/admin may reach it, and
 * merchant_staff is rejected with 403 (staff sees Today's Code and nothing
 * else, PRD §3.2). The creation logic — draft/scheduled lifecycle, allowance
 * consumption, the 402 soft block — is WP-6, so an authorized caller gets
 * NOT_IMPLEMENTED (501) naming that package rather than a fake success. The
 * WP-6 gate asserts no NOT_IMPLEMENTED remains here.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/drops",
    operationId: "createDrop",
    summary: "Create a drop",
    description: "Role gate is live (WP-5); the creation flow is WP-6.",
    tags: ["Drops"],
    auth: "user",
    // WP-6 defines the full body; for the gate the location identifies the org.
    request: { body: z.object({ location_id: z.uuid() }) },
    response: { data: z.object({ id: z.string() }) },
    errors: ["FORBIDDEN", "NOT_FOUND", "ALLOWANCE_EXHAUSTED", "NOT_IMPLEMENTED"],
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForLocation(body.location_id));
    throw new ApiError(
      "NOT_IMPLEMENTED",
      "Drop creation (lifecycle and allowance consumption) is not built yet.",
      { pending_work_package: "WP-6" },
    );
  },
);

export const POST = route.handler;
