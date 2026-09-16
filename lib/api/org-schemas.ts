import { z } from "@/lib/zod";

export const orgResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    lane: z.string(),
    status: z.string(),
    tier: z.string(),
    max_locations: z.number(),
    drops_per_cycle: z.number(),
    drops_pooled_org_level: z.boolean(),
    cycle_anchor_at: z.string(),
    created_at: z.string(),
  })
  .openapi("Organization");

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
  })
  .openapi("Billing");
