import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { orgResponseSchema, patchOrgSchema } from "@/lib/api/org-schemas";
import { getOrg, updateOrg } from "@/lib/orgs";
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

/** Edit an org's own profile (name, logo). Owner or admin only. Tier and limits
 *  are billing-governed and not editable here. */
const patchRoute = defineRoute(
  {
    method: "patch",
    path: "/v1/orgs/{id}",
    operationId: "patchOrg",
    summary: "Edit an organization's profile (name, logo)",
    tags: ["Merchant"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }), body: patchOrgSchema },
    response: { data: orgResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"],
  },
  async ({ params, body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, params.id);
    return { data: await updateOrg(params.id, body) };
  },
);

export const PATCH = patchRoute.handler;
