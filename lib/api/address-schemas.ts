import { z } from "@/lib/zod";

/**
 * Address request/response schemas.
 *
 * The create and patch bodies are STRICT: any unknown key — lat, lng, or
 * anything else — is a VALIDATION_ERROR. A client-supplied coordinate is a
 * spoofed market, so it is rejected outright rather than ignored (invariant
 * #10). Coordinates are server-geocoded and appear only in responses.
 */

export const addressResponseSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    line1: z.string(),
    line2: z.string().nullable(),
    city: z.string(),
    region: z.string(),
    postal_code: z.string(),
    country: z.string(),
    radius_miles: z.number(),
    is_home: z.boolean(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    formatted_address: z.string().nullable(),
    geo_location_type: z.string().nullable(),
  })
  .openapi("Address");

const radius = z.number().int().min(1).max(60);

export const addressCreateSchema = z
  .strictObject({
    label: z.string().min(1).max(80),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).optional(),
    city: z.string().min(1).max(120),
    region: z.string().min(1).max(80),
    postal_code: z.string().min(1).max(20),
    country: z.string().length(2).optional(),
    radius_miles: radius.optional(),
  })
  .openapi("AddressCreate");

export const addressPatchSchema = z
  .strictObject({
    label: z.string().min(1).max(80).optional(),
    line1: z.string().min(1).max(200).optional(),
    line2: z.string().max(200).nullable().optional(),
    city: z.string().min(1).max(120).optional(),
    region: z.string().min(1).max(80).optional(),
    postal_code: z.string().min(1).max(20).optional(),
    country: z.string().length(2).optional(),
    radius_miles: radius.optional(),
  })
  .openapi("AddressPatch");
