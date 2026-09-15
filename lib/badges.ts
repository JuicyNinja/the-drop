import { getServiceClient } from "@/lib/supabase/server";

/**
 * Badges (PRD §10.4, DATA-MODEL §11.4): permanent achievements, a system SEPARATE
 * from clout — they do NOT decay and are NOT capped. Nothing in the clout
 * recompute ever touches `user_badges`, and awarding is a plain idempotent insert
 * with no score, percentile, tier, or per-city cap.
 *
 * The badge CATALOG is deliberately empty in v1 (a product decision left open,
 * DATA-MODEL §11.4), so there are no concrete slugs to award yet. This module is
 * the award + read mechanism the catalog will plug into; it takes a slug that
 * must already exist in `badges`.
 */

export interface EarnedBadge {
  slug: string;
  label: string;
  description: string;
  earned_at: string;
}

/**
 * Award a badge to a user. Idempotent — re-awarding the same badge is a no-op and
 * never a second row or a second anything (there is no count to compound; badges
 * are held, not accumulated). Returns whether this call newly awarded it.
 */
export async function awardBadge(userId: string, slug: string): Promise<boolean> {
  const svc = getServiceClient();
  const { data: badge, error: bErr } = await svc.from("badges").select("id").eq("slug", slug).maybeSingle();
  if (bErr) throw new Error(`badge lookup failed: ${bErr.message}`);
  if (!badge) throw new Error(`no such badge: ${slug}`);

  const { data, error } = await svc
    .from("user_badges")
    .upsert({ user_id: userId, badge_id: badge.id as string }, { onConflict: "user_id,badge_id", ignoreDuplicates: true })
    .select("badge_id");
  if (error) throw new Error(`award badge failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** A user's earned badges. Never decays, never expires. */
export async function listBadges(userId: string): Promise<EarnedBadge[]> {
  const { data, error } = await getServiceClient()
    .from("user_badges")
    .select("earned_at, badges!inner(slug, label, description)")
    .eq("user_id", userId)
    .order("earned_at", { ascending: false });
  if (error) throw new Error(`list badges failed: ${error.message}`);
  return (data ?? []).map((r) => {
    const b = r.badges as unknown as { slug: string; label: string; description: string };
    return { slug: b.slug, label: b.label, description: b.description, earned_at: r.earned_at as string };
  });
}
