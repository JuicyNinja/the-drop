import { ApiError } from "@/lib/api/errors";
import { normalizeHandle, validateHandle } from "@/lib/handles";
import { sanitizeText } from "@/lib/sanitize";
import { getServiceClient } from "@/lib/supabase/server";
import { assertHandleAvailable } from "@/lib/auth/registration";
import { formatUserNumber, getUserById, type UserRecord } from "@/lib/users";

/** The self profile (GET /v1/users/me). The auth uid is never included. */
export interface MeProfile {
  user_number: string;
  user_number_display: string;
  handle: string;
  handle_locked: boolean;
  full_name: string;
  email: string;
  email_verified: boolean;
  phone: string;
  phone_verified: boolean;
  location_permission_granted: boolean;
  walkthrough_completed: boolean;
  active_address_id: string | null;
  // A role without a scope is meaningless: each role carries its org/location.
  // Platform admin has both null.
  roles: { role: string; org_id: string | null; location_id: string | null }[];
  clout_tier: number | null;
  badges: { slug: string; label: string; earned_at: string }[];
  addresses: {
    id: string;
    label: string;
    city: string;
    region: string;
    radius_miles: number;
    is_home: boolean;
  }[];
  follows: { org_id: string; lane: string; tier: string }[];
  preference_tags: string[];
  notification_prefs: {
    push_enabled: boolean;
    email_enabled: boolean;
    sms_enabled: boolean;
    digest_hour_local: number;
  } | null;
}

export async function getMeProfile(user: UserRecord): Promise<MeProfile> {
  const svc = getServiceClient();
  const [roles, badges, addresses, follows, tags, prefs, clout] = await Promise.all([
    svc.from("user_roles").select("role, org_id, location_id").eq("user_id", user.id),
    svc.from("user_badges").select("earned_at, badges(slug, label)").eq("user_id", user.id),
    svc.from("addresses").select("id, label, city, region, radius_miles, is_home").eq("user_id", user.id),
    svc.from("follows").select("org_id, lane, tier").eq("user_id", user.id),
    svc.from("user_tags").select("tags(slug)").eq("user_id", user.id),
    svc.from("notification_prefs").select("push_enabled, email_enabled, sms_enabled, digest_hour_local").eq("user_id", user.id).maybeSingle(),
    svc.from("clout_scores").select("tier").eq("user_id", user.id).order("tier", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return {
    user_number: user.user_number,
    user_number_display: formatUserNumber(user.user_number),
    handle: user.handle,
    handle_locked: user.handle_changed_at !== null,
    full_name: user.full_name,
    email: user.email,
    email_verified: user.email_verified_at !== null,
    phone: user.phone,
    phone_verified: user.phone_verified_at !== null,
    location_permission_granted: user.location_perm_granted_at !== null,
    walkthrough_completed: user.walkthrough_completed_at !== null,
    active_address_id: user.active_address_id,
    roles: (roles.data ?? []).map((r) => ({
      role: r.role as string,
      org_id: (r.org_id as string | null) ?? null,
      location_id: (r.location_id as string | null) ?? null,
    })),
    clout_tier: (clout.data?.tier as number | undefined) ?? null,
    badges: (badges.data ?? []).map((b) => {
      const badge = b.badges as unknown as { slug: string; label: string } | null;
      return { slug: badge?.slug ?? "", label: badge?.label ?? "", earned_at: b.earned_at as string };
    }),
    addresses: (addresses.data ?? []).map((a) => ({
      id: a.id as string,
      label: a.label as string,
      city: a.city as string,
      region: a.region as string,
      radius_miles: a.radius_miles as number,
      is_home: a.is_home as boolean,
    })),
    follows: (follows.data ?? []).map((f) => ({
      org_id: f.org_id as string,
      lane: f.lane as string,
      tier: f.tier as string,
    })),
    preference_tags: (tags.data ?? [])
      .map((t) => (t.tags as unknown as { slug: string } | null)?.slug)
      .filter((s): s is string => Boolean(s)),
    notification_prefs: prefs.data
      ? {
          push_enabled: prefs.data.push_enabled as boolean,
          email_enabled: prefs.data.email_enabled as boolean,
          sms_enabled: prefs.data.sms_enabled as boolean,
          digest_hour_local: prefs.data.digest_hour_local as number,
        }
      : null,
  };
}

export interface ProfilePatch {
  full_name?: string;
  handle?: string;
  email?: string;
  notification_prefs?: {
    push_enabled?: boolean;
    email_enabled?: boolean;
    sms_enabled?: boolean;
    digest_hour_local?: number;
  };
}

/**
 * Apply a profile patch. Mutable: full_name, handle (once), email, notification
 * prefs. user_number and phone are immutable here (phone has its own verified
 * flow) and rejected upstream by the request schema. Handle change beyond the
 * first is HANDLE_LOCKED (DB trigger is the backstop).
 */
export async function updateMeProfile(
  user: UserRecord,
  patch: ProfilePatch,
): Promise<UserRecord> {
  const svc = getServiceClient();
  const update: Record<string, unknown> = {};

  if (patch.full_name !== undefined) {
    const clean = sanitizeText(patch.full_name, 200);
    if (!clean) {
      throw new ApiError("VALIDATION_ERROR", "Invalid full_name.", {
        body: [{ path: "full_name", message: "required" }],
      });
    }
    update.full_name = clean;
  }

  if (patch.email !== undefined) {
    update.email = patch.email.toLowerCase();
  }

  if (patch.handle !== undefined && normalizeHandle(patch.handle) !== normalizeHandle(user.handle)) {
    if (user.handle_changed_at !== null) {
      throw new ApiError("HANDLE_LOCKED", "Handle already changed once and is permanently locked.");
    }
    const validated = validateHandle(patch.handle);
    if (!validated.ok) {
      throw new ApiError("VALIDATION_ERROR", validated.problem.message, {
        body: [{ path: "handle", message: validated.problem.rule }],
      });
    }
    await assertHandleAvailable(validated.handle);
    update.handle = validated.handle;
  }

  if (Object.keys(update).length > 0) {
    update.updated_at = new Date().toISOString();
    const { error } = await svc.from("users").update(update).eq("id", user.id);
    if (error) {
      if (error.code === "23505" && /handle/i.test(error.message)) {
        throw new ApiError("HANDLE_TAKEN", "That handle is not available.");
      }
      // The handle-lock trigger raises P0001 if a second change slips through.
      if (/permanently locked/i.test(error.message)) {
        throw new ApiError("HANDLE_LOCKED", "Handle already changed once and is permanently locked.");
      }
      throw new Error(`profile update failed: ${error.message}`);
    }
  }

  if (patch.notification_prefs) {
    const np = patch.notification_prefs;
    const row: Record<string, unknown> = { user_id: user.id };
    if (np.push_enabled !== undefined) row.push_enabled = np.push_enabled;
    if (np.email_enabled !== undefined) row.email_enabled = np.email_enabled;
    if (np.sms_enabled !== undefined) row.sms_enabled = np.sms_enabled;
    if (np.digest_hour_local !== undefined) row.digest_hour_local = np.digest_hour_local;
    const { error } = await svc.from("notification_prefs").upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(`notification prefs update failed: ${error.message}`);
  }

  const updated = await getUserById(user.id);
  if (!updated) throw new Error("user vanished during update");
  return updated;
}
