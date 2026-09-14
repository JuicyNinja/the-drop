import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { orgResponseSchema } from "@/lib/api/org-schemas";
import { getOrg } from "@/lib/orgs";
import { requireOwner } from "@/lib/auth/org-access";

/** Org detail. Owner or admin only. */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/orgs/{id}",
    operationId: "getOrg",
    summary: "Get an organization",
    tags: ["Merchant"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: { data: orgResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, params.id);
    return { data: await getOrg(params.id) };
  },
);

export const GET = route.handler;
