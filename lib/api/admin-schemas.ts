import { z } from "@/lib/zod";

/** Shared response schemas for the admin surface (API-CONTRACT §11). */

export const adminOrgSchema = z.object({
  id: z.string(), name: z.string(), lane: z.string(), status: z.string(), tier: z.string(),
  max_locations: z.number(), drops_per_cycle: z.number(), drops_pooled_org_level: z.boolean(),
  cycle_anchor_at: z.string(), created_at: z.string(),
});

export const adminUserSchema = z.object({
  id: z.string(), user_number: z.string(), user_number_display: z.string(), handle: z.string(),
  full_name: z.string(), email: z.string(),
  suspended_at: z.string().nullable(), clout_frozen_at: z.string().nullable(), deleted_at: z.string().nullable(),
  created_at: z.string(),
});

export const adminCitySchema = z.object({
  id: z.string(), name: z.string(), region: z.string(), country: z.string(),
  lat: z.number(), lng: z.number(), timezone: z.string(),
  default_geofence_m: z.number(), coldstart_days: z.number(), coldstart_min_events: z.number(),
  active: z.boolean(), launched_at: z.string().nullable(),
});

export const adminTagSchema = z.object({
  id: z.string(), parent_id: z.string().nullable(), slug: z.string(), label: z.string(),
  synonyms: z.array(z.string()), lanes: z.array(z.string()), selectable: z.boolean(),
  active: z.boolean(), sort_order: z.number(),
});

export const riskProfileSchema = z.object({
  user_id: z.string(),
  catches_total: z.number(),
  redemptions_total: z.number(),
  abandoned_catches: z.number(),
  redemption_rate: z.number().nullable(),
  transfers_received_total: z.number(),
  distinct_transfer_senders: z.number(),
  whisper_count: z.number(),
  return_rate: z.number().nullable(),
  chargeback_count: z.number().nullable(),
  dispute_loss_count: z.number().nullable(),
  needs_review: z.boolean(),
  review_reasons: z.array(z.string()),
  computed_at: z.string(),
});
