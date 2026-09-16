import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/admin/audit";
import type { AdminActor } from "@/lib/admin/actor";

/**
 * Admin taxonomy management (API-CONTRACT §11, invariant #13: the taxonomy is
 * platform-controlled, never free text). Groups (parent_id null) are not
 * selectable and carry no lanes; leaves carry at least one lane. Audited.
 */

const TAG_COLUMNS = "id, parent_id, slug, label, synonyms, lanes, selectable, active, sort_order";

export interface AdminTag {
  id: string; parent_id: string | null; slug: string; label: string;
  synonyms: string[]; lanes: string[]; selectable: boolean; active: boolean; sort_order: number;
}

export async function listTagsAdmin(): Promise<AdminTag[]> {
  const { data, error } = await getServiceClient().from("tags").select(TAG_COLUMNS).order("parent_id", { ascending: true, nullsFirst: true }).order("sort_order", { ascending: true });
  if (error) throw new Error(`list tags failed: ${error.message}`);
  return (data ?? []) as AdminTag[];
}

async function loadTag(id: string): Promise<AdminTag> {
  const { data, error } = await getServiceClient().from("tags").select(TAG_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`load tag failed: ${error.message}`);
  if (!data) throw new ApiError("NOT_FOUND", "No such tag.");
  return data as AdminTag;
}

export interface CreateTagInput {
  parent_id?: string | null;
  slug: string;
  label: string;
  synonyms?: string[];
  lanes?: string[];
  selectable?: boolean;
  sort_order?: number;
}

export async function createTagAdmin(actor: AdminActor, input: CreateTagInput): Promise<AdminTag> {
  const isGroup = !input.parent_id;
  // Mirror the DB constraints so the API returns a clean 4xx, not a raw 23xxx.
  if (isGroup && (input.selectable || (input.lanes && input.lanes.length > 0))) {
    throw new ApiError("VALIDATION_ERROR", "A group (no parent) is not selectable and carries no lanes.", { body: [{ path: "parent_id", message: "group must be unselectable with empty lanes" }] });
  }
  if (!isGroup && (!input.lanes || input.lanes.length === 0)) {
    throw new ApiError("VALIDATION_ERROR", "A leaf tag needs at least one lane.", { body: [{ path: "lanes", message: "required for a leaf" }] });
  }
  const row = {
    parent_id: input.parent_id ?? null,
    slug: input.slug,
    label: input.label,
    synonyms: input.synonyms ?? [],
    lanes: input.lanes ?? [],
    selectable: isGroup ? false : (input.selectable ?? true),
    active: true,
    sort_order: input.sort_order ?? 0,
  };
  const { data, error } = await getServiceClient().from("tags").insert(row).select(TAG_COLUMNS).single();
  if (error) {
    if (error.code === "23505") throw new ApiError("VALIDATION_ERROR", "That slug is already taken.", { body: [{ path: "slug", message: "unique" }] });
    throw new Error(`create tag failed: ${error.message}`);
  }
  const after = data as AdminTag;
  await writeAudit({ actorId: actor.actorId, action: "tag.create", targetType: "tag", targetId: after.id, before: null, after, ip: actor.ip });
  return after;
}

export interface TagPatch {
  label?: string;
  synonyms?: string[];
  lanes?: string[];
  active?: boolean;
  sort_order?: number;
}

export async function patchTagAdmin(actor: AdminActor, id: string, patch: TagPatch): Promise<AdminTag> {
  const before = await loadTag(id);
  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.synonyms !== undefined) update.synonyms = patch.synonyms;
  if (patch.lanes !== undefined) {
    if (before.parent_id !== null && patch.lanes.length === 0) {
      throw new ApiError("VALIDATION_ERROR", "A leaf tag needs at least one lane.", { body: [{ path: "lanes", message: "required for a leaf" }] });
    }
    update.lanes = patch.lanes;
  }
  if (patch.active !== undefined) update.active = patch.active;
  if (patch.sort_order !== undefined) update.sort_order = patch.sort_order;
  if (Object.keys(update).length === 0) return before;

  const { data, error } = await getServiceClient().from("tags").update(update).eq("id", id).select(TAG_COLUMNS).single();
  if (error) throw new Error(`update tag failed: ${error.message}`);
  const after = data as AdminTag;
  await writeAudit({ actorId: actor.actorId, action: "tag.update", targetType: "tag", targetId: id, before, after, ip: actor.ip });
  return after;
}
