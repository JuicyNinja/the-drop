import { getServiceClient } from "@/lib/supabase/server";

/**
 * Merchant score (PRD §10.2, DATA-MODEL §11.6): trailing redemption quality.
 * NOT a ranking input — surfaced on drop detail and the business listing.
 * Recomputed daily.
 *
 * WP-10 decisions (recorded in the BUILD-PLAN):
 *   - Window: trailing 90 days, anchored to the top of the current day so two
 *     runs on the same day are identical (deterministic, like the clout recompute).
 *   - redemption_rate = redemptions / catches over the window.
 *   - whisper_score = mean over the window's whispers of a 0..1 composite:
 *     avg( wouldReturn?1:0, (dim_2-1)/4, (dim_3-1)/4, (dim_4-1)/4 ). Null with no
 *     whispers.
 *   - New / insufficient merchants (no catches in the window) are SEEDED at the
 *     cohort median redemption_rate — neither punished with a 0 nor handed a
 *     gameable 1 (DATA-MODEL §11.6). The cohort is orgs that DO have data.
 */

const WINDOW_DAYS = 90;

export interface MerchantScoreResult {
  orgs: number;
  cohort_median: number | null;
  seeded_at_median: number; // orgs with no window data that took the median
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export async function recomputeMerchantScores(now: Date = new Date()): Promise<MerchantScoreResult> {
  const svc = getServiceClient();
  const dayStart = new Date(Math.floor(now.getTime() / 86_400_000) * 86_400_000);
  const since = new Date(dayStart.getTime() - WINDOW_DAYS * 86_400_000).toISOString();

  const { data: orgs, error: oErr } = await svc.from("organizations").select("id");
  if (oErr) throw new Error(`load orgs failed: ${oErr.message}`);

  interface Row { org: string; rate: number | null; whisper: number | null; dropsCounted: number }
  const rows: Row[] = [];

  for (const o of orgs ?? []) {
    const orgId = o.id as string;
    const { data: drops, error: dErr } = await svc.from("drops").select("id").eq("org_id", orgId);
    if (dErr) throw new Error(`load org drops failed: ${dErr.message}`);
    const dropIds = (drops ?? []).map((d) => d.id as string);

    let catches = 0, redemptions = 0, dropsCounted = 0;
    if (dropIds.length > 0) {
      const { data: cRows, error: cErr } = await svc.from("catches").select("drop_id").in("drop_id", dropIds).gte("caught_at", since);
      if (cErr) throw new Error(`count catches failed: ${cErr.message}`);
      catches = (cRows ?? []).length;
      dropsCounted = new Set((cRows ?? []).map((r) => r.drop_id as string)).size;

      const { count: rCount, error: rErr } = await svc.from("redemptions").select("id", { count: "exact", head: true }).in("drop_id", dropIds).gte("redeemed_at", since);
      if (rErr) throw new Error(`count redemptions failed: ${rErr.message}`);
      redemptions = rCount ?? 0;
    }

    // whisper_score over the window.
    const { data: whispers, error: wErr } = await svc
      .from("whispers")
      .select("would_return_at_full_price, dim_2, dim_3, dim_4")
      .eq("org_id", orgId)
      .gte("created_at", since);
    if (wErr) throw new Error(`load whispers failed: ${wErr.message}`);
    let whisper: number | null = null;
    if ((whispers ?? []).length > 0) {
      const sum = (whispers ?? []).reduce((acc, w) => {
        const composite = ((w.would_return_at_full_price ? 1 : 0) + (Number(w.dim_2) - 1) / 4 + (Number(w.dim_3) - 1) / 4 + (Number(w.dim_4) - 1) / 4) / 4;
        return acc + composite;
      }, 0);
      whisper = sum / (whispers ?? []).length;
    }

    rows.push({ org: orgId, rate: catches > 0 ? redemptions / catches : null, whisper, dropsCounted });
  }

  const cohortMedian = median(rows.filter((r) => r.rate !== null).map((r) => r.rate as number));

  let seeded = 0;
  const upserts = rows.map((r) => {
    const seededRate = r.rate === null;
    if (seededRate) seeded++;
    return {
      org_id: r.org,
      // New/insufficient orgs take the cohort median (0 only if no cohort exists).
      redemption_rate: Number((r.rate ?? cohortMedian ?? 0).toFixed(4)),
      whisper_score: r.whisper === null ? null : Number(r.whisper.toFixed(4)),
      drops_counted: r.dropsCounted,
      // Store the cohort median so the rate can be shown in context ("typical is
      // 64%"). Same platform-wide value on every row for this run.
      cohort_median: cohortMedian === null ? null : Number(cohortMedian.toFixed(4)),
      computed_at: now.toISOString(),
    };
  });

  if (upserts.length > 0) {
    const { error: upErr } = await svc.from("merchant_scores").upsert(upserts, { onConflict: "org_id" });
    if (upErr) throw new Error(`merchant score upsert failed: ${upErr.message}`);
  }

  return { orgs: rows.length, cohort_median: cohortMedian === null ? null : Number(cohortMedian.toFixed(4)), seeded_at_median: seeded };
}
