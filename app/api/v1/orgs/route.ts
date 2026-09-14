import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { createOrgSchema, orgResponseSchema } from "@/lib/api/org-schemas";
import { createOrg } from "@/lib/orgs";

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
