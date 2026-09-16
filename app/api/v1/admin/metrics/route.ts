import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { getPlatformMetrics } from "@/lib/admin/metrics";

/** Platform metrics (admin), including the saved-address demand map. */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/admin/metrics",
    operationId: "adminMetrics",
    summary: "Platform metrics (admin)",
    tags: ["Admin"],
    auth: "user",
    response: {
      data: z.object({
        users: z.number(),
        orgs_active: z.number(),
        drops_live: z.number(),
        catches_total: z.number(),
        redemptions_total: z.number(),
        cities_launched: z.number(),
        demand_map: z.array(z.object({
          city: z.string(), region: z.string(), saved_addresses: z.number(),
          lat: z.number().nullable(), lng: z.number().nullable(),
        })),
      }),
    },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await getPlatformMetrics() };
  },
);

export const GET = route.handler;
