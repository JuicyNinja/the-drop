import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { createLocationSchema, locationResponseSchema } from "@/lib/api/org-schemas";
import { createLocation, getOrg, listLocations } from "@/lib/orgs";
import { requireOwner } from "@/lib/auth/org-access";

const params = z.object({ id: z.uuid() });

/** List an org's locations. Owner/admin only. */
const listRoute = defineRoute(
  {
    method: "get",
    path: "/v1/orgs/{id}/locations",
    operationId: "listOrgLocations",
    summary: "List locations",
    tags: ["Merchant"],
    auth: "user",
    request: { params },
    response: { data: z.object({ locations: z.array(locationResponseSchema) }) },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params: p, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, p.id);
    return { data: { locations: await listLocations(p.id) } };
  },
);

/**
 * Add a location. Geocoded server-side (no client lat/lng). Returns 402
 * ALLOWANCE_EXHAUSTED with the upgrade payload when the org is at its stored
 * max_locations — the Add Location control is always shown; the paywall is the
 * pitch (never hide it).
 */
const createRoute = defineRoute(
  {
    method: "post",
    path: "/v1/orgs/{id}/locations",
    operationId: "createOrgLocation",
    summary: "Add a location",
    tags: ["Merchant"],
    auth: "user",
    request: { params, body: createLocationSchema },
    response: { status: 201, data: locationResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND", "ALLOWANCE_EXHAUSTED", "VALIDATION_ERROR"],
  },
  async ({ params: p, body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, p.id);
    const org = await getOrg(p.id);
    return { data: await createLocation(org, body) };
  },
);

export const GET = listRoute.handler;
export const POST = createRoute.handler;
