import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { adminOrgSchema } from "@/lib/api/admin-schemas";
import { ipFromRequest } from "@/lib/admin/audit";
import { delistOrg } from "@/lib/admin/orgs";

/** Delist an org (admin): removed from discovery; Gone drops stay reachable
 *  (invariant #11). Audited. */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/admin/orgs/{id}/delist",
    operationId: "adminDelistOrg",
    summary: "Delist an org (admin)",
    tags: ["Admin"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: { data: adminOrgSchema },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ user, params, request }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await delistOrg({ actorId: user.id, ip: ipFromRequest(request) }, params.id) };
  },
);

export const POST = route.handler;
