import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";
import { recordWhisperClout } from "@/lib/clout";

/**
 * Whispers (PRD §10.5, DATA-MODEL §11.5): private post-redemption feedback, a
 * four-dimension rating ANCHORED on "would you return at full price". Read-only
 * for the owning merchant, never public — RLS (whispers_select) is the authority
 * on who may read; this module only writes and reads through the service client
 * for the two allowed API surfaces (author submits, owner/admin lists).
 *
 * One whisper per redemption (unique(redemption_id)). Submitting one earns clout.
 */

export interface WhisperInput {
  redemption_id: string;
  would_return_at_full_price: boolean;
  dim_2: number;
  dim_3: number;
  dim_4: number;
  note?: string | null;
}

export interface WhisperCreated {
  id: string;
  clout_earned: number;
}

export async function createWhisper(userId: string, input: WhisperInput): Promise<WhisperCreated> {
  const svc = getServiceClient();

  // The redemption must exist and belong to the caller. Do not reveal a
  // redemption that is not theirs.
  const { data: redemption, error: rErr } = await svc
    .from("redemptions")
    .select("id, user_id, location_id")
    .eq("id", input.redemption_id)
    .maybeSingle();
  if (rErr) throw new Error(`load redemption failed: ${rErr.message}`);
  if (!redemption || redemption.user_id !== userId) throw new ApiError("NOT_FOUND", "No such redemption.");

  const { data: loc, error: lErr } = await svc
    .from("locations")
    .select("id, org_id, city_id")
    .eq("id", redemption.location_id as string)
    .maybeSingle();
  if (lErr) throw new Error(`load location failed: ${lErr.message}`);
  if (!loc) throw new Error("redemption location missing");

  const { data: whisper, error: wErr } = await svc
    .from("whispers")
    .insert({
      redemption_id: input.redemption_id,
      user_id: userId,
      org_id: loc.org_id as string,
      location_id: loc.id as string,
      would_return_at_full_price: input.would_return_at_full_price,
      dim_2: input.dim_2,
      dim_3: input.dim_3,
      dim_4: input.dim_4,
      note: input.note ? input.note.slice(0, 2000) : null,
    })
    .select("id")
    .single();
  if (wErr) {
    if (wErr.code === "23505") throw new ApiError("VALIDATION_ERROR", "You have already whispered this redemption.", { body: [{ path: "redemption_id", message: "duplicate" }] });
    throw new Error(`create whisper failed: ${wErr.message}`);
  }

  const cloutEarned = await recordWhisperClout(userId, (loc.city_id as string | null) ?? null, whisper.id as string);
  return { id: whisper.id as string, clout_earned: cloutEarned };
}

export interface OrgWhisper {
  id: string;
  would_return_at_full_price: boolean;
  dim_2: number;
  dim_3: number;
  dim_4: number;
  note: string | null;
  drop_title: string;
  created_at: string;
}

/**
 * Whispers for an org, newest first. The owner/admin gate is enforced by the
 * route. Buyer identity is intentionally omitted from the merchant view — the
 * merchant gets the feedback, not a way to single out the customer who left it.
 */
export async function listOrgWhispers(orgId: string): Promise<OrgWhisper[]> {
  const { data, error } = await getServiceClient()
    .from("whispers")
    .select("id, would_return_at_full_price, dim_2, dim_3, dim_4, note, created_at, redemptions!inner(drops!inner(title))")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`list org whispers failed: ${error.message}`);
  return (data ?? []).map((r) => {
    const redemption = r.redemptions as unknown as { drops: { title: string } };
    return {
      id: r.id as string,
      would_return_at_full_price: r.would_return_at_full_price as boolean,
      dim_2: r.dim_2 as number,
      dim_3: r.dim_3 as number,
      dim_4: r.dim_4 as number,
      note: (r.note as string | null) ?? null,
      drop_title: redemption.drops?.title ?? "a drop",
      created_at: r.created_at as string,
    };
  });
}
