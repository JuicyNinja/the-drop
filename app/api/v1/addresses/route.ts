import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { addressCreateSchema, addressResponseSchema } from "@/lib/api/address-schemas";
import { createAddress, listAddresses } from "@/lib/addresses";

/** API-CONTRACT §3: list the caller's saved addresses. */
const listRoute = defineRoute(
  {
    method: "get",
    path: "/v1/addresses",
    operationId: "listAddresses",
    summary: "List my addresses",
    tags: ["Addresses"],
    auth: "user",
    response: { data: z.object({ addresses: z.array(addressResponseSchema) }) },
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: { addresses: await listAddresses(user.id) } };
  },
);

/**
 * API-CONTRACT §3: create an address. Geocoded server-side; the strict body
 * rejects any client-supplied lat/lng (a spoofed market) with VALIDATION_ERROR.
 */
const createRoute = defineRoute(
  {
    method: "post",
    path: "/v1/addresses",
    operationId: "createAddress",
    summary: "Add an address",
    description: "Geocoded server-side. Client never supplies lat/lng.",
    tags: ["Addresses"],
    auth: "user",
    request: { body: addressCreateSchema },
    response: { status: 201, data: addressResponseSchema },
    errors: ["VALIDATION_ERROR"],
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await createAddress(user.id, body) };
  },
);

export const GET = listRoute.handler;
export const POST = createRoute.handler;
