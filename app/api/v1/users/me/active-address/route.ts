import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { setActiveAddress } from "@/lib/addresses";
import { resolveActiveMarket } from "@/lib/geo/market";

/**
 * API-CONTRACT §3: set the active address. Drives the Local board, the Local
 * digest, and radius matching. Governs discovery only; never consulted at
 * redemption. The response returns the resolved market so the header's
 * persistent active-address indicator can update immediately.
 */
const route = defineRoute(
  {
    method: "put",
    path: "/v1/users/me/active-address",
    operationId: "setActiveAddress",
    summary: "Set active address",
    tags: ["Users"],
    auth: "user",
    request: { body: z.strictObject({ address_id: z.uuid() }) },
    response: {
      data: z.object({
        active_address_id: z.string(),
        market: z
          .object({
            label: z.string(),
            center: z.object({ lat: z.number(), lng: z.number() }).nullable(),
            radius_miles: z.number(),
            nearest_city: z
              .object({ id: z.string(), name: z.string(), region: z.string() })
              .nullable(),
          })
          .nullable(),
      }),
    },
    errors: ["NOT_FOUND"],
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await setActiveAddress(user.id, body.address_id);
    const market = await resolveActiveMarket(user.id);
    return {
      data: {
        active_address_id: body.address_id,
        market: market
          ? {
              label: market.label,
              center: market.center,
              radius_miles: market.radius_miles,
              nearest_city: market.nearest_city,
            }
          : null,
      },
    };
  },
);

export const PUT = route.handler;
