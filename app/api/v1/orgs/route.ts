import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { createOrgSchema, orgResponseSchema } from "@/lib/api/org-schemas";
import { createOrg, listOrgsForUser } from "@/lib/orgs";

/**
 * Create an organization. The caller becomes its owner. Self-serve tiers seed
 * their limits from the catalog; Enterprise/custom limits are admin-only and
 * stored as given (never derived from the tier enum thereafter).
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/orgs",
    operationId: "createOrg",
    summary: "Create an organization",
    tags: ["Merchant"],
    auth: "user",
    request: { body: createOrgSchema },
    response: { status: 201, data: orgResponseSchema },
    errors: ["FORBIDDEN", "VALIDATION_ERROR"],
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await createOrg(user, body) };
  },
);

export const POST = route.handler;

/**
 * The caller's merchant memberships — how the operator portal discovers its org
 * context (API-CONTRACT §10). Always an array; a pure buyer gets [], never 403.
 * A native client uses the same call to build its org switcher.
 */
const listRoute = defineRoute(
  {
    method: "get",
    path: "/v1/orgs",
    operationId: "listMyOrgs",
    summary: "Orgs the caller has a merchant role on",
    tags: ["Merchant"],
    auth: "user",
    response: {
      data: z.array(
        z.object({
          org_id: z.string(),
          name: z.string(),
          lane: z.string(),
          role: z.enum(["merchant_owner", "merchant_staff"]),
          tier: z.string(),
          status: z.string(),
          locations: z.array(z.object({ id: z.string(), name: z.string(), city: z.string() })),
        }),
      ),
    },
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await listOrgsForUser(user.id) };
  },
);

export const GET = listRoute.handler;
