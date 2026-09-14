import { z } from "@/lib/zod";

export const dropResponseSchema = z
  .object({
    id: z.string(),
    lane: z.string(),
    org_id: z.string(),
    location_id: z.string().nullable(),
    status: z.string(),
    title: z.string(),
    description: z.string(),
    terms: z.string().nullable(),
    image_urls: z.array(z.string()).nullable(),
    quantity_total: z.number(),
    quantity_remaining: z.number(),
    price_cents: z.number().nullable(),
    live_at: z.string().nullable(),
    live_until: z.string().nullable(),
    redeem_from: z.string().nullable(),
    redeem_until: z.string().nullable(),
    parent_drop_id: z.string().nullable(),
    duplicated_from_id: z.string().nullable(),
    gone_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi("Drop");

const iso = z.string().min(1);

export const createDropSchema = z
  .strictObject({
    location_id: z.uuid(),
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(4000),
    terms: z.string().max(4000).optional(),
    quantity_total: z.number().int().min(1).max(1000000),
    live_at: iso.optional(),
    live_until: iso.optional(),
    redeem_from: iso.optional(),
    redeem_until: iso.optional(),
    image_urls: z.array(z.string()).max(10).optional(),
    // Create-and-publish in one call: schedule immediately (402 at cap).
    publish: z.boolean().optional(),
  })
  .openapi("CreateDrop");

export const patchDropSchema = z
  .strictObject({
    // Field edits (draft/scheduled only; live → DROP_IMMUTABLE).
    title: z.string().min(1).max(140).optional(),
    description: z.string().min(1).max(4000).optional(),
    terms: z.string().max(4000).nullable().optional(),
    quantity_total: z.number().int().min(1).max(1000000).optional(),
    live_at: iso.nullable().optional(),
    live_until: iso.nullable().optional(),
    redeem_from: iso.nullable().optional(),
    redeem_until: iso.nullable().optional(),
    image_urls: z.array(z.string()).max(10).optional(),
    // Lifecycle transitions: schedule (consumes allowance) or cancel back to draft.
    status: z.enum(["scheduled", "draft"]).optional(),
  })
  .openapi("PatchDrop");

export const upgradeSchema = z
  .strictObject({ target_tier: z.string().min(1) })
  .openapi("SubscriptionUpgrade");
