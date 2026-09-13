import { z } from "@/lib/zod";

/** The session envelope returned by callback and refresh. Registered once. */
export const sessionSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number(),
    expires_at: z.number().nullable(),
    token_type: z.string(),
  })
  .openapi("Session");

/** Address collected at registration (client never supplies lat/lng). */
export const addressInputSchema = z
  .object({
    label: z.string().min(1).max(80),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).optional(),
    city: z.string().min(1).max(120),
    region: z.string().min(1).max(80),
    postal_code: z.string().min(1).max(20),
    country: z.string().length(2).optional(),
  })
  .openapi("AddressInput");
