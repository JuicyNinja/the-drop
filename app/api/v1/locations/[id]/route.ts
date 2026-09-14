import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { locationResponseSchema, patchLocationSchema } from "@/lib/api/org-schemas";
import { deactivateLocation, getLocation, updateLocation } from "@/lib/orgs";
import { orgIdForLocation, requireOwner } from "@/lib/auth/org-access";

const params = z.object({ id: z.uuid() });

const getRoute = defineRoute(
  {
    method: "get",
    path: "/v1/locations/{id}",
    operationId: "getLocation",
    summary: "Get a location",
    tags: ["Merchant"],
    auth: "user",
    request: { params },
    response: { data: locationResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params: p, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForLocation(p.id));
    return { data: await getLocation(p.id) };
  },
);

/** Edit a location. Re-geocoded only when a line changes. Owner/admin only. */
const patchRoute = defineRoute(
  {
    method: "patch",
    path: "/v1/locations/{id}",
    operationId: "updateLocation",
    summary: "Edit a location",
    tags: ["Merchant"],
    auth: "user",
    request: { params, body: patchLocationSchema },
    response: { data: locationResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"],
  },
  async ({ params: p, body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForLocation(p.id));
    return { data: await updateLocation(p.id, body) };
  },
);

/** Soft-delete (deactivate) a location. Owner/admin only. */
const deleteRoute = defineRoute(
  {
    method: "delete",
    path: "/v1/locations/{id}",
    operationId: "deleteLocation",
    summary: "Deactivate a location",
    tags: ["Merchant"],
    auth: "user",
    request: { params },
    response: { data: z.object({ deactivated: z.literal(true) }) },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params: p, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForLocation(p.id));
    await deactivateLocation(p.id);
    return { data: { deactivated: true } };
  },
);

export const GET = getRoute.handler;
export const PATCH = patchRoute.handler;
export const DELETE = deleteRoute.handler;
