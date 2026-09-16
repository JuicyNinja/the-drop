import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { adminCitySchema } from "@/lib/api/admin-schemas";
import { ipFromRequest } from "@/lib/admin/audit";
import { patchCityAdmin } from "@/lib/admin/cities";

/**
 * Configure a city (admin): geofence radius, cold-start window (days) and event
 * threshold, IANA timezone, and launch (active → stamps launched_at once).
 * Audited.
 */
const route = defineRoute(
  {
    method: "patch",
    path: "/v1/admin/cities/{id}",
    operationId: "adminPatchCity",
    summary: "Configure or launch a city (admin)",
    tags: ["Admin"],
    auth: "user",
    request: {
      params: z.object({ id: z.uuid() }),
      body: z.strictObject({
        name: z.string().min(1).optional(),
        region: z.string().min(1).optional(),
        timezone: z.string().min(1).optional(),
        default_geofence_m: z.number().int().min(1).optional(),
        coldstart_days: z.number().int().min(0).optional(),
        coldstart_min_events: z.number().int().min(0).optional(),
        active: z.boolean().optional(),
      }),
    },
    response: { data: adminCitySchema },
    errors: ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"],
  },
  async ({ user, params, body, request }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await patchCityAdmin({ actorId: user.id, ip: ipFromRequest(request) }, params.id, body) };
  },
);

export const PATCH = route.handler;
