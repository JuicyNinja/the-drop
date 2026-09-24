import { z } from "@/lib/zod";

export const orgResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    lane: z.string(),
    status: z.string(),
    tier: z.string(),
    logo_url: z.string().nullable(),
    max_locations: z.number(),
    drops_per_cycle: z.number(),
    drops_pooled_org_level: z.boolean(),
    cycle_anchor_at: z.string(),
    created_at: z.string(),
  })
  .openapi("Organization");

// A logo is a small square mark: either a local static path or an inline data:
// URI (the operator upload resizes client-side to a compact webp). Capped so an
// oversized upload is rejected at the edge, not stored.
const logoUrl = z
  .string()
  .max(512_000)
  .refine((s) => s.startsWith("data:image/") || s.startsWith("/"), "expected an image data: URI or a local path");

export const patchOrgSchema = z
  .strictObject({
    name: z.string().min(1).max(120).optional(),
    logo_url: logoUrl.nullable().optional(),
  })
  .openapi("PatchOrg");

export const createOrgSchema = z
  .strictObject({
    name: z.string().min(1).max(120),
    lane: z.enum(["local", "maker", "digital"]).optional(),
    tier: z.string().min(1),
    // Admin/Enterprise only: explicit stored limits.
    max_locations: z.number().int().min(1).max(1000).optional(),
    drops_per_cycle: z.number().int().min(1).max(100000).optional(),
    drops_pooled_org_level: z.boolean().optional(),
  })
  .openapi("CreateOrg");

export const locationResponseSchema = z
  .object({
    id: z.string(),
    org_id: z.string(),
    name: z.string(),
    line1: z.string(),
    line2: z.string().nullable(),
    city: z.string(),
    region: z.string(),
    postal_code: z.string(),
    country: z.string(),
    lat: z.number(),
    lng: z.number(),
    geofence_radius_m: z.number(),
    active: z.boolean(),
    created_at: z.string(),
  })
  .openapi("Location");

// Strict: rejects client-supplied lat/lng (geocoded server-side) and unknowns.
export const createLocationSchema = z
  .strictObject({
    name: z.string().min(1).max(120),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).optional(),
    city: z.string().min(1).max(120),
    region: z.string().min(1).max(80),
    postal_code: z.string().min(1).max(20),
    country: z.string().length(2).optional(),
    geofence_radius_m: z.number().int().min(25).max(5000).optional(),
  })
  .openapi("CreateLocation");

export const patchLocationSchema = z
  .strictObject({
    name: z.string().min(1).max(120).optional(),
    line1: z.string().min(1).max(200).optional(),
    line2: z.string().max(200).nullable().optional(),
    city: z.string().min(1).max(120).optional(),
    region: z.string().min(1).max(80).optional(),
    postal_code: z.string().min(1).max(20).optional(),
    country: z.string().length(2).optional(),
    geofence_radius_m: z.number().int().min(25).max(5000).optional(),
    active: z.boolean().optional(),
  })
  .openapi("PatchLocation");

export const addStaffSchema = z
  .strictObject({ to_handle: z.string().min(1).max(40), location_id: z.uuid() })
  .openapi("AddStaff");

export const billingResponseSchema = z
  .object({
    tier: z.string(),
    max_locations: z.number(),
    drops_per_cycle: z.number(),
    drops_pooled_org_level: z.boolean(),
    active_locations: z.number(),
    cycle: z.object({ start: z.string(), end: z.string() }),
    billing_interval: z.enum(["monthly", "annual"]),
    // The annual contract offer for the current tier ($9/3-month intro then the
    // annual monthly rate). null when the org is already annual or the tier has
    // no self-serve annual price (enterprise).
    annual_offer: z
      .object({
        annual_price_cents: z.number(),
        annual_monthly_cents: z.number(),
        intro_monthly_cents: z.number(),
        intro_months: z.number(),
        year_total_cents: z.number(),
      })
      .nullable(),
  })
  .openapi("Billing");
