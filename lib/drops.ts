import { ApiError } from "@/lib/api/errors";
import { sanitizeText } from "@/lib/sanitize";
import { getServiceClient } from "@/lib/supabase/server";
import { seedInventory } from "@/lib/redis";
import { consumeDropAllowance, currentCycle, type OrgLimits } from "@/lib/billing/allowance";
import { upgradeOptions } from "@/lib/billing/tiers";
import { getOrg } from "@/lib/orgs";

/**
 * Drop lifecycle (PRD §4). Local goes draft → scheduled → live → gone|expired,
 * skipping the approval states entirely. Allowance is consumed when a drop is
 * scheduled and never restored on cancel (invariant #2). Once live, quantity,
 * price, terms, and window are frozen by a DB trigger; the API surfaces that as
 * DROP_IMMUTABLE. Adding supply is only ever an Encore (new linked drop); no
 * path raises a counter or restocks.
 */

export interface DropRecord {
  id: string;
  lane: string;
  org_id: string;
  location_id: string | null;
  city_id: string | null;
  status: string;
  title: string;
  description: string;
  terms: string | null;
  image_urls: string[] | null;
  quantity_total: number;
  quantity_remaining: number;
  price_cents: number | null;
  live_at: string | null;
  live_until: string | null;
  redeem_from: string | null;
  redeem_until: string | null;
  parent_drop_id: string | null;
  duplicated_from_id: string | null;
  gone_at: string | null;
  created_by: string;
  created_at: string;
}

export const DROP_COLUMNS =
  "id, lane, org_id, location_id, city_id, status, title, description, terms, image_urls, quantity_total, quantity_remaining, price_cents, live_at, live_until, redeem_from, redeem_until, parent_drop_id, duplicated_from_id, gone_at, created_by, created_at";

export async function getDrop(dropId: string): Promise<DropRecord> {
  const { data, error } = await getServiceClient().from("drops").select(DROP_COLUMNS).eq("id", dropId).maybeSingle();
  if (error) throw new Error(`load drop failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such drop.");
  return data as DropRecord;
}

function mapWriteError(error: { code?: string; message: string }): ApiError | null {
  if (error.code === "P0001") {
    if (/immutable/i.test(error.message)) return new ApiError("DROP_IMMUTABLE", "This drop is live and can no longer be edited. Create an Encore instead.");
    if (/Counters never/i.test(error.message)) return new ApiError("DROP_IMMUTABLE", "Counters never go up. Create an Encore.");
    if (/Local drops never enter/i.test(error.message)) return new ApiError("VALIDATION_ERROR", error.message);
    if (/Invalid drop status transition/i.test(error.message)) return new ApiError("VALIDATION_ERROR", error.message);
  }
  return null;
}

export interface CreateDropInput {
  location_id: string;
  title: string;
  description: string;
  terms?: string | null;
  quantity_total: number;
  live_at?: string | null;
  live_until?: string | null;
  redeem_from?: string | null;
  redeem_until?: string | null;
  image_urls?: string[];
}

/** Resolve the org that owns a location (drops are created from a location). */
async function locationOrg(locationId: string): Promise<{ org_id: string; city_id: string | null }> {
  const { data, error } = await getServiceClient().from("locations").select("org_id, city_id").eq("id", locationId).maybeSingle();
  if (error) throw new Error(`load location failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such location.");
  return { org_id: data.org_id as string, city_id: (data.city_id as string | null) ?? null };
}

/** Create a Local drop as a draft. Allowance is NOT consumed until scheduled. */
export async function createDraft(userId: string, input: CreateDropInput): Promise<DropRecord> {
  const { org_id, city_id } = await locationOrg(input.location_id);
  const title = sanitizeText(input.title, 140);
  const description = sanitizeText(input.description, 4000);
  if (!title || !description) {
    throw new ApiError("VALIDATION_ERROR", "Title and description are required.", { body: [{ path: "title", message: "required" }] });
  }
  const { data, error } = await getServiceClient()
    .from("drops")
    .insert({
      lane: "local",
      org_id,
      location_id: input.location_id,
      city_id,
      status: "draft",
      title,
      description,
      terms: input.terms ? sanitizeText(input.terms, 4000) : null,
      image_urls: input.image_urls ?? null,
      quantity_total: input.quantity_total,
      quantity_remaining: input.quantity_total,
      price_cents: null, // local has no price
      live_at: input.live_at ?? null,
      live_until: input.live_until ?? null,
      redeem_from: input.redeem_from ?? null,
      redeem_until: input.redeem_until ?? null,
      created_by: userId,
    })
    .select(DROP_COLUMNS)
    .single();
  if (error) {
    const mapped = mapWriteError(error);
    if (mapped) throw mapped;
    throw new Error(`create drop failed: ${error.message}`);
  }
  return data as DropRecord;
}

export interface PatchDropInput {
  title?: string;
  description?: string;
  terms?: string | null;
  quantity_total?: number;
  live_at?: string | null;
  live_until?: string | null;
  redeem_from?: string | null;
  redeem_until?: string | null;
  image_urls?: string[];
}

/** Edit an unscheduled/scheduled drop's fields. Live drops → DROP_IMMUTABLE. */
export async function patchDraft(dropId: string, patch: PatchDropInput): Promise<DropRecord> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = sanitizeText(patch.title, 140);
  if (patch.description !== undefined) update.description = sanitizeText(patch.description, 4000);
  if (patch.terms !== undefined) update.terms = patch.terms ? sanitizeText(patch.terms, 4000) : null;
  if (patch.quantity_total !== undefined) {
    update.quantity_total = patch.quantity_total;
    update.quantity_remaining = patch.quantity_total; // pre-live, remaining tracks total
  }
  if (patch.live_at !== undefined) update.live_at = patch.live_at;
  if (patch.live_until !== undefined) update.live_until = patch.live_until;
  if (patch.redeem_from !== undefined) update.redeem_from = patch.redeem_from;
  if (patch.redeem_until !== undefined) update.redeem_until = patch.redeem_until;
  if (patch.image_urls !== undefined) update.image_urls = patch.image_urls;
  if (Object.keys(update).length === 0) return getDrop(dropId);
  update.updated_at = new Date().toISOString();

  const { data, error } = await getServiceClient().from("drops").update(update).eq("id", dropId).select(DROP_COLUMNS).single();
  if (error) {
    const mapped = mapWriteError(error);
    if (mapped) throw mapped;
    throw new Error(`patch drop failed: ${error.message}`);
  }
  return data as DropRecord;
}

/** The 402 upgrade payload for the drop cap, from the org's stored limits. */
function dropCapError(org: OrgLimits & { tier: string }, dropsUsed: number): ApiError {
  const cycle = currentCycle(org.cycle_anchor_at);
  const { options, enterprise_contact } = upgradeOptions(org.tier, "drops", cycle.end);
  return new ApiError("ALLOWANCE_EXHAUSTED", `You've used all ${org.drops_per_cycle} drops this cycle.`, {
    current_tier: org.tier,
    drops_used: dropsUsed,
    drops_per_cycle: org.drops_per_cycle,
    cycle_ends_at: cycle.end,
    upgrade_options: options,
    enterprise_contact,
  });
}

/**
 * Schedule a draft: consume allowance (402 at cap), then transition to
 * scheduled. Consumption is authoritative and happens FIRST, so a capped org
 * never gets a scheduled drop. Requires the go-live and redemption window.
 */
export async function scheduleDrop(dropId: string): Promise<DropRecord> {
  const drop = await getDrop(dropId);
  if (drop.status !== "draft") {
    throw new ApiError("VALIDATION_ERROR", `Only a draft can be scheduled (this drop is ${drop.status}).`);
  }
  if (!drop.live_at || !drop.redeem_from || !drop.redeem_until) {
    throw new ApiError("VALIDATION_ERROR", "Set the go-live time and redemption window before scheduling.", {
      body: [{ path: "live_at", message: "required to schedule" }],
    });
  }
  if (!drop.location_id) throw new ApiError("VALIDATION_ERROR", "A local drop needs a location.");

  const org = await getOrg(drop.org_id);
  const consumed = await consumeDropAllowance(org, drop.location_id);
  if (!consumed.ok) {
    throw dropCapError(org, org.drops_per_cycle);
  }

  const { data, error } = await getServiceClient().from("drops").update({ status: "scheduled", updated_at: new Date().toISOString() }).eq("id", dropId).select(DROP_COLUMNS).single();
  if (error) {
    const mapped = mapWriteError(error);
    if (mapped) throw mapped;
    throw new Error(`schedule drop failed: ${error.message}`);
  }
  return data as DropRecord;
}

/**
 * Cancel a scheduled drop back to draft. Allowance is NOT restored — a
 * cancelled drop still consumed its allowance (prevents create/cancel farming).
 */
export async function cancelDrop(dropId: string): Promise<DropRecord> {
  const { data, error } = await getServiceClient().from("drops").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", dropId).select(DROP_COLUMNS).single();
  if (error) {
    const mapped = mapWriteError(error);
    if (mapped) throw mapped;
    throw new Error(`cancel drop failed: ${error.message}`);
  }
  return data as DropRecord;
}

async function cloneToDraft(source: DropRecord, userId: string, extra: { parent_drop_id?: string; duplicated_from_id?: string }): Promise<DropRecord> {
  const { data, error } = await getServiceClient()
    .from("drops")
    .insert({
      lane: source.lane,
      org_id: source.org_id,
      location_id: source.location_id,
      city_id: source.city_id,
      status: "draft",
      title: source.title,
      description: source.description,
      terms: source.terms,
      image_urls: source.image_urls,
      quantity_total: source.quantity_total,
      quantity_remaining: source.quantity_total,
      price_cents: source.price_cents,
      live_at: null, // a clone/encore is scheduled to a NEW date
      live_until: null,
      redeem_from: null,
      redeem_until: null,
      parent_drop_id: extra.parent_drop_id ?? null,
      duplicated_from_id: extra.duplicated_from_id ?? null,
      created_by: userId,
    })
    .select(DROP_COLUMNS)
    .single();
  if (error) throw new Error(`clone drop failed: ${error.message}`);
  return data as DropRecord;
}

/** Duplicate any drop to a new draft. Consumes allowance only when scheduled. */
export async function duplicateDrop(dropId: string, userId: string): Promise<DropRecord> {
  const source = await getDrop(dropId);
  return cloneToDraft(source, userId, { duplicated_from_id: source.id });
}

/**
 * Encore: the ONLY mechanism for adding supply. Available only from `gone`.
 * Marks the parent `encore_pending` and creates a NEW linked drop with
 * parent_drop_id set. The parent's quantity is never touched.
 */
export async function encoreDrop(dropId: string, userId: string): Promise<DropRecord> {
  const source = await getDrop(dropId);
  if (source.status !== "gone") {
    throw new ApiError("VALIDATION_ERROR", "An Encore is available only for a Gone drop.");
  }
  const { error: tErr } = await getServiceClient().from("drops").update({ status: "encore_pending", updated_at: new Date().toISOString() }).eq("id", source.id);
  if (tErr) {
    const mapped = mapWriteError(tErr);
    if (mapped) throw mapped;
    throw new Error(`encore transition failed: ${tErr.message}`);
  }
  return cloneToDraft(source, userId, { parent_drop_id: source.id });
}

// ---------------------------------------------------------------------------
// Scheduler jobs (PRD/DATA-MODEL §18). Run every 15s by an external ticker in
// production; invoked directly by the admin tick route and the gate here.
// ---------------------------------------------------------------------------

/** Go-live: scheduled drops whose live_at has passed → live, and seed Redis. */
export async function runGoLive(now: Date = new Date()): Promise<{ went_live: string[] }> {
  const svc = getServiceClient();
  const { data, error } = await svc
    .from("drops")
    .select("id, quantity_total")
    .eq("status", "scheduled")
    .lte("live_at", now.toISOString());
  if (error) throw new Error(`go-live query failed: ${error.message}`);

  const wentLive: string[] = [];
  for (const d of data ?? []) {
    const id = d.id as string;
    // Concurrency-safe transition: the UPDATE is conditional on the row still
    // being 'scheduled' and RETURNS the row. Under two simultaneous tickers,
    // exactly one wins (returns a row); the loser matches 0 rows and skips.
    // So a drop is transitioned once and only the winner proceeds to seed.
    const { data: won, error: uErr } = await svc
      .from("drops")
      .update({ status: "live", updated_at: now.toISOString() })
      .eq("id", id)
      .eq("status", "scheduled")
      .select("id");
    if (uErr) {
      console.error(`[go-live] ${id} failed`, uErr.message);
      continue;
    }
    if (!won || won.length === 0) continue; // lost the race; another ticker has it
    // Seed Redis inventory for the live window (the catch contract, WP-7,
    // consumes this). SET NX is a second guard: even a duplicate reaches here
    // only via the winning update, and NX makes re-seeding a no-op regardless.
    await seedInventory(id, d.quantity_total as number);
    wentLive.push(id);
  }
  return { went_live: wentLive };
}

/** Close: live drops past their window → gone (sold out) or expired (remaining). */
export async function runClose(now: Date = new Date()): Promise<{ gone: string[]; expired: string[] }> {
  const svc = getServiceClient();
  const { data, error } = await svc
    .from("drops")
    .select("id, quantity_remaining, live_until")
    .eq("status", "live");
  if (error) throw new Error(`close query failed: ${error.message}`);

  const gone: string[] = [];
  const expired: string[] = [];
  for (const d of data ?? []) {
    const id = d.id as string;
    const remaining = d.quantity_remaining as number;
    const liveUntil = d.live_until as string | null;
    const windowPassed = liveUntil !== null && new Date(liveUntil) <= now;
    // Same concurrency-safe pattern: conditional on status='live', returning
    // the row, so exactly one ticker closes a given drop.
    if (remaining <= 0) {
      const { data: w } = await svc.from("drops").update({ status: "gone", gone_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", id).eq("status", "live").select("id");
      if (w && w.length > 0) gone.push(id);
    } else if (windowPassed) {
      const { data: w } = await svc.from("drops").update({ status: "expired", updated_at: now.toISOString() }).eq("id", id).eq("status", "live").select("id");
      if (w && w.length > 0) expired.push(id);
    }
  }
  return { gone, expired };
}
