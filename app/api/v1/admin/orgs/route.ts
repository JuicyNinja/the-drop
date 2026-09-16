import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { adminOrgSchema } from "@/lib/api/admin-schemas";
import { listOrgsAdmin } from "@/lib/admin/orgs";

/** All organizations (admin). Optional status filter. */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/admin/orgs",
    operationId: "adminListOrgs",
    summary: "List organizations (admin)",
    tags: ["Admin"],
    auth: "user",
    request: { query: z.object({ status: z.string().optional() }) },
    response: { data: z.array(adminOrgSchema) },
    errors: ["FORBIDDEN"],
  },
  async ({ user, query }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await listOrgsAdmin({ status: query.status }) };
  },
);

export const GET = route.handler;
