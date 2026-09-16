import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { getMeProfile, updateMeProfile } from "@/lib/auth/profile";

/**
 * API-CONTRACT §2: the self profile. The auth uid is never included;
 * user_number and handle are the public identity. user_number is returned raw
 * (bigint as string) and zero-padded to 14 for display only.
 */
const meProfileSchema = z
  .object({
    user_number: z.string(),
    user_number_display: z.string(),
    handle: z.string(),
    handle_locked: z.boolean(),
    full_name: z.string(),
    email: z.string(),
    email_verified: z.boolean(),
    phone: z.string(),
    phone_verified: z.boolean(),
    location_permission_granted: z.boolean(),
    walkthrough_completed: z.boolean(),
    active_address_id: z.string().nullable(),
    roles: z.array(
      z.object({
        role: z.string(),
        org_id: z.string().nullable(),
        location_id: z.string().nullable(),
      }),
    ),
    clout_tier: z.number().nullable(),
    badges: z.array(
      z.object({ slug: z.string(), label: z.string(), earned_at: z.string() }),
    ),
    addresses: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        city: z.string(),
        region: z.string(),
        radius_miles: z.number(),
        is_home: z.boolean(),
      }),
    ),
    follows: z.array(
      z.object({ org_id: z.string(), lane: z.string(), tier: z.string() }),
    ),
    preference_tags: z.array(z.string()),
    notification_prefs: z
      .object({
        push_enabled: z.boolean(),
        email_enabled: z.boolean(),
        sms_enabled: z.boolean(),
        digest_hour_local: z.number(),
      })
      .nullable(),
  })
  .openapi("MeProfile");

const getRoute = defineRoute(
  {
    method: "get",
    path: "/v1/users/me",
    operationId: "usersGetMe",
    summary: "Get my profile",
    tags: ["Users"],
    auth: "user",
    response: { data: meProfileSchema },
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await getMeProfile(user) };
  },
);

const patchRoute = defineRoute(
  {
    method: "patch",
    path: "/v1/users/me",
    operationId: "usersPatchMe",
    summary: "Update my profile",
    description:
      "Mutable: full_name, handle (once), email, notification prefs. user_number and phone are immutable and rejected.",
    tags: ["Users"],
    auth: "user",
    request: {
      // Strict: user_number, phone, or any other field is a VALIDATION_ERROR.
      body: z
        .strictObject({
          full_name: z.string().min(1).max(200).optional(),
          handle: z.string().min(3).max(20).optional(),
          email: z.email().optional(),
          notification_prefs: z
            .object({
              push_enabled: z.boolean().optional(),
              email_enabled: z.boolean().optional(),
              sms_enabled: z.boolean().optional(),
              digest_hour_local: z.number().int().min(0).max(23).optional(),
            })
            .optional(),
        })
        .openapi("ProfilePatch"),
    },
    response: { data: meProfileSchema },
    errors: ["HANDLE_LOCKED", "HANDLE_TAKEN", "VALIDATION_ERROR"],
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    const updated = await updateMeProfile(user, body);
    return { data: await getMeProfile(updated) };
  },
);

export const GET = getRoute.handler;
export const PATCH = patchRoute.handler;
