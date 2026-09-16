import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { adminOrgSchema } from "@/lib/api/admin-schemas";
import { ipFromRequest } from "@/lib/admin/audit";
import { patchOrgAdmin } from "@/lib/admin/orgs";

/** Edit an org's tier, stored limits, or status (admin). Limits are arbitrary
 *  stored values (Enterprise), never derived from the tier enum. Audited. */
const route = defineRoute(
  {
    method: "patch",
    path: "/v1/admin/orgs/{id}",
    operationId: "adminPatchOrg",
    summary: "Edit an org (admin)",
    tags: ["Admin"],
    auth: "user",
    request: {
      params: z.object({ id: z.uuid() }),
      body: z.strictObject({
        tier: z.string().min(1).optional(),
        max_locations: z.number().int().min(0).optional(),
        drops_per_cycle: z.number().int().min(0).optional(),
        drops_pooled_org_level: z.boolean().optional(),
        status: z.enum(["active", "past_due", "suspended", "delisted", "cancelled"]).optional(),
      }),
    },
    response: { data: adminOrgSchema },
    errors: ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"],
  },
  async ({ user, params, body, request }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await patchOrgAdmin({ actorId: user.id, ip: ipFromRequest(request) }, params.id, body) };
  },
);

export const PATCH = route.handler;
