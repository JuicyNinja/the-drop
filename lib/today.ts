import { getServiceClient } from "@/lib/supabase/server";
import { phonetic } from "@/lib/codes";

/**
 * Today's Code (API-CONTRACT §10): the merchant counter screen. The code per
 * live drop with phonetic guidance for reading it aloud, plus a live redemption
 * feed. This is a MERCHANT surface, so the feed DOES mark unverified entries —
 * the unverified flag is invisible to the buyer, visible here and in admin.
 */

export interface TodayCode {
  drop_id: string;
  code: string;
  phonetic: string;
  title: string;
  redeem_until: string | null;
}
export interface TodayFeedItem {
  handle: string;
  position_number: number;
  method: string; // gps_verified | unverified_timeout — merchant-facing only
  unverified: boolean;
  at: string;
}
export interface TodayScreen {
  codes: TodayCode[];
  feed: TodayFeedItem[];
}

export async function getTodayScreen(locationId: string): Promise<TodayScreen> {
  const svc = getServiceClient();

  const { data: drops, error: dErr } = await svc
    .from("drops")
    .select("id, code, title, redeem_until")
    .eq("location_id", locationId)
    .eq("status", "live");
  if (dErr) throw new Error(`today codes failed: ${dErr.message}`);

  const codes: TodayCode[] = (drops ?? [])
    .filter((d) => d.code)
    .map((d) => ({
      drop_id: d.id as string,
      code: d.code as string,
      phonetic: phonetic(d.code as string),
      title: d.title as string,
      redeem_until: (d.redeem_until as string | null) ?? null,
    }));

  // redemptions → catches (position) and redemptions → users (the redeemer's
  // handle) are each a single FK, so embed both directly. Embedding users under
  // catches is ambiguous (catches has user_id AND original_user_id).
  const { data: feed, error: fErr } = await svc
    .from("redemptions")
    .select("method, redeemed_at, catches!inner(position_number), users!inner(handle)")
    .eq("location_id", locationId)
    .order("redeemed_at", { ascending: false })
    .limit(50);
  if (fErr) throw new Error(`today feed failed: ${fErr.message}`);

  const feedItems: TodayFeedItem[] = (feed ?? []).map((r) => {
    const c = r.catches as unknown as { position_number: number };
    const u = r.users as unknown as { handle: string };
    const method = r.method as string;
    return {
      handle: u.handle,
      position_number: c.position_number,
      method,
      unverified: method === "unverified_timeout",
      at: r.redeemed_at as string,
    };
  });

  return { codes, feed: feedItems };
}
