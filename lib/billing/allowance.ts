import { getServiceClient } from "@/lib/supabase/server";

/**
 * Drop-allowance model. THE fork in the billing model
 * (`drops_pooled_org_level`): pooled true counts one allowance org-wide across
 * all locations; false counts each location against its own. This is the most
 * common place to get the billing wrong, so the scope decision lives in exactly
 * one function (`scopeLocation`) and both the preview and the consume use it.
 *
 * Limits are read from the org row and passed through; nothing here derives a
 * limit from the tier enum. The counter only ever increases (invariant #2).
 */

const CYCLE_DAYS = 30;
const CYCLE_MS = CYCLE_DAYS * 24 * 60 * 60 * 1000;

export interface OrgLimits {
  id: string;
  tier: string;
  drops_per_cycle: number;
  drops_pooled_org_level: boolean;
  cycle_anchor_at: string;
}

export interface Cycle {
  start: string;
  end: string;
}

/** The current 30-day cycle window, anchored on the org's creation anniversary. */
export function currentCycle(anchorAt: string, now: Date = new Date()): Cycle {
  const anchor = new Date(anchorAt).getTime();
  const elapsed = now.getTime() - anchor;
  const n = Math.max(0, Math.floor(elapsed / CYCLE_MS));
  const start = anchor + n * CYCLE_MS;
  return { start: new Date(start).toISOString(), end: new Date(start + CYCLE_MS).toISOString() };
}

/** Pooled → org-level scope (null location); else the given location. */
export function scopeLocation(pooled: boolean, locationId: string): string | null {
  return pooled ? null : locationId;
}

export interface AllowanceView {
  drops_used: number;
  drops_per_cycle: number;
  drops_remaining: number;
  at_cap: boolean;
  pooled: boolean;
  cycle: Cycle;
}

/** Read-only allowance snapshot for a scope, without consuming. */
export async function previewAllowance(org: OrgLimits, locationId: string): Promise<AllowanceView> {
  const cycle = currentCycle(org.cycle_anchor_at);
  const scope = scopeLocation(org.drops_pooled_org_level, locationId);

  let query = getServiceClient()
    .from("drop_allowance_usage")
    .select("drops_used")
    .eq("org_id", org.id)
    .eq("cycle_start", cycle.start);
  query = scope === null ? query.is("location_id", null) : query.eq("location_id", scope);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`preview allowance failed: ${error.message}`);

  const used = (data?.drops_used as number | undefined) ?? 0;
  return {
    drops_used: used,
    drops_per_cycle: org.drops_per_cycle,
    drops_remaining: Math.max(0, org.drops_per_cycle - used),
    at_cap: used >= org.drops_per_cycle,
    pooled: org.drops_pooled_org_level,
    cycle,
  };
}

export interface ConsumeResult {
  ok: boolean;
  drops_used: number | null;
  cycle: Cycle;
}

/**
 * Consume one drop from the org's allowance for the given location's scope.
 * Atomic and race-safe (DB function). Returns ok:false when at cap.
 */
export async function consumeDropAllowance(org: OrgLimits, locationId: string): Promise<ConsumeResult> {
  const cycle = currentCycle(org.cycle_anchor_at);
  const scope = scopeLocation(org.drops_pooled_org_level, locationId);

  const { data, error } = await getServiceClient().rpc("app_consume_drop_allowance", {
    p_org: org.id,
    p_location: scope,
    p_cycle_start: cycle.start,
    p_cycle_end: cycle.end,
    p_limit: org.drops_per_cycle,
  });
  if (error) throw new Error(`consume allowance failed: ${error.message}`);

  const used = data as number;
  return used < 0 ? { ok: false, drops_used: null, cycle } : { ok: true, drops_used: used, cycle };
}
