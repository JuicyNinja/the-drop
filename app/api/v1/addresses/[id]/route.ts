import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { addressPatchSchema, addressResponseSchema } from "@/lib/api/address-schemas";
import { deleteAddress, updateAddress } from "@/lib/addresses";

const params = z.object({ id: z.uuid() });

/**
 * API-CONTRACT §3: edit an address. Re-geocoded only when a line of the address
 * changes; a label- or radius-only edit does not trigger a lookup. Strict body
 * rejects client-supplied lat/lng.
 */
const patchRoute = defineRoute(
  {
    method: "patch",
    path: "/v1/addresses/{id}",
    operationId: "updateAddress",
    summary: "Edit an address",
    tags: ["Addresses"],
    auth: "user",
    request: { params, body: addressPatchSchema },
    response: { data: addressResponseSchema },
    errors: ["NOT_FOUND", "VALIDATION_ERROR"],
  },
  async ({ params: p, body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await updateAddress(user.id, p.id, body) };
  },
);

/**
 * API-CONTRACT §3: delete an address. Home is undeletable; deleting the active
 * address falls back to Home.
 */
const deleteRoute = defineRoute(
  {
    method: "delete",
    path: "/v1/addresses/{id}",
    operationId: "deleteAddress",
    summary: "Delete an address",
    tags: ["Addresses"],
    auth: "user",
    request: { params },
    response: { data: z.object({ deleted: z.literal(true), active_address_id: z.string().nullable() }) },
    errors: ["NOT_FOUND", "VALIDATION_ERROR"],
  },
  async ({ params: p, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    const result = await deleteAddress(user.id, p.id);
    return { data: { deleted: true, active_address_id: result.active_address_id } };
  },
);

export const PATCH = patchRoute.handler;
export const DELETE = deleteRoute.handler;
