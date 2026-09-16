import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { adminCitySchema } from "@/lib/api/admin-schemas";
import { ipFromRequest } from "@/lib/admin/audit";
import { listCitiesAdmin, createCityAdmin } from "@/lib/admin/cities";

/** List cities (admin). */
const listRoute = defineRoute(
  {
    method: "get",
    path: "/v1/admin/cities",
    operationId: "adminListCities",
    summary: "List cities (admin)",
    tags: ["Admin"],
    auth: "user",
    response: { data: z.array(adminCitySchema) },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await listCitiesAdmin() };
  },
);

/** Create a city (admin). Created inactive; launched later via PATCH. Audited. */
const createRoute = defineRoute(
  {
    method: "post",
    path: "/v1/admin/cities",
    operationId: "adminCreateCity",
    summary: "Create a city (admin)",
    tags: ["Admin"],
    auth: "user",
    request: {
      body: z.strictObject({
        name: z.string().min(1),
        region: z.string().min(1),
        country: z.string().min(2).max(2).optional(),
        lat: z.number(),
        lng: z.number(),
        timezone: z.string().min(1).optional(),
        default_geofence_m: z.number().int().min(1).optional(),
        coldstart_days: z.number().int().min(0).optional(),
        coldstart_min_events: z.number().int().min(0).optional(),
      }),
    },
    response: { status: 201, data: adminCitySchema },
    errors: ["FORBIDDEN", "VALIDATION_ERROR"],
  },
  async ({ user, body, request }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await createCityAdmin({ actorId: user.id, ip: ipFromRequest(request) }, body) };
  },
);

export const GET = listRoute.handler;
export const POST = createRoute.handler;
