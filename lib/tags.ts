import { getServiceClient } from "@/lib/supabase/server";

/**
 * The platform taxonomy (PRD §10.1, API-CONTRACT §8). Two levels: groups
 * (parent_id null, browsable chips, never selectable) and leaves (selectable).
 * There is NO free-text search over drop content anywhere — this searches
 * categories only.
 */

export interface TagSearchHit {
  id: string;
  label: string;
  group: string;
  matched_on: string; // 'label' | 'synonym'
}

/**
 * Category type-ahead. Runs through the `search_tags` SQL function, whose WHERE
 * clause matches the `tags_search` GIN index expression exactly
 * (`tag_search_document(label, synonyms) @@ plainto_tsquery(...)`), so the index
 * is used rather than a sequential scan (WP-2 finding). Leaves only.
 */
export async function searchTags(q: string, lane?: string, limit = 10): Promise<TagSearchHit[]> {
  const { data, error } = await getServiceClient().rpc("search_tags", {
    q,
    p_lane: lane ?? null,
    p_limit: limit,
  });
  if (error) throw new Error(`tag search failed: ${error.message}`);
  return (data ?? []).map((r: { id: string; label: string; group_label: string; matched_on: string }) => ({
    id: r.id,
    label: r.label,
    group: r.group_label,
    matched_on: r.matched_on,
  }));
}

export interface TagGroup {
  id: string;
  label: string;
  leaves: { id: string; label: string; slug: string }[];
}

/**
 * The two-level tree for the filter picker. `lane` scopes leaves to a lane;
 * `selectableOnly` returns leaves without their group wrapper.
 */
export async function getTagTree(lane?: string): Promise<TagGroup[]> {
  const svc = getServiceClient();
  const { data, error } = await svc
    .from("tags")
    .select("id, parent_id, slug, label, lanes, selectable, sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`load tags failed: ${error.message}`);
  const rows = data ?? [];

  const groups = rows.filter((r) => r.parent_id === null);
  const groupById = new Map<string, TagGroup>();
  for (const g of groups) groupById.set(g.id as string, { id: g.id as string, label: g.label as string, leaves: [] });

  for (const leaf of rows) {
    if (leaf.parent_id === null) continue;
    if (lane && !((leaf.lanes as string[]) ?? []).includes(lane)) continue;
    const group = groupById.get(leaf.parent_id as string);
    if (group) group.leaves.push({ id: leaf.id as string, label: leaf.label as string, slug: leaf.slug as string });
  }

  // Only groups that have at least one leaf in the requested lane.
  return [...groupById.values()].filter((g) => g.leaves.length > 0);
}

/**
 * The set of leaf tag ids implied by a filter selection: the leaf itself, or —
 * if the id is a group — all of the group's leaves. Used to filter the board.
 */
export async function leafIdsForFilter(tagId: string): Promise<string[]> {
  const svc = getServiceClient();
  const { data, error } = await svc.from("tags").select("id, parent_id").eq("id", tagId).maybeSingle();
  if (error) throw new Error(`load tag failed: ${error.message}`);
  if (!data) return [];
  if (data.parent_id !== null) return [tagId]; // a leaf
  const { data: leaves, error: lErr } = await svc.from("tags").select("id").eq("parent_id", tagId).eq("active", true);
  if (lErr) throw new Error(`load group leaves failed: ${lErr.message}`);
  return (leaves ?? []).map((r) => r.id as string);
}
