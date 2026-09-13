import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { getServiceClient } from "@/lib/supabase/server";

/**
 * API-CONTRACT §2 / §7.4: the hard location gate. Granting sets
 * location_perm_granted_at; until it is non-null, POST /catches and
 * POST /redemptions both return LOCATION_PERMISSION_REQUIRED. Denial is a
 * blocking state, never an alternate path — sending granted:false clears it.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/users/me/location-permission",
    operationId: "usersSetLocationPermission",
    summary: "Set location permission",
    tags: ["Users"],
    auth: "user",
    request: { body: z.object({ granted: z.boolean() }) },
    response: { data: z.object({ location_permission_granted: z.boolean() }) },
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    const granted_at = body.granted ? new Date().toISOString() : null;
    const { error } = await getServiceClient()
      .from("users")
      .update({ location_perm_granted_at: granted_at, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (error) throw new Error(`set location permission failed: ${error.message}`);
    return { data: { location_permission_granted: body.granted } };
  },
);

export const POST = route.handler;
