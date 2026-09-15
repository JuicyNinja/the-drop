import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { getPrefs, setPrefs } from "@/lib/notifications";

/**
 * API-CONTRACT §2/§9: the caller's notification preferences. Channels can be
 * disabled per user, and `digest_hour_local` sets when their daily digest sends.
 * Transfer SMS ignores `sms_enabled` (user-initiated, 5-minute clock) — enforced
 * in lib/transfers, not here. There are no quiet hours.
 */
const prefsSchema = z.object({
  push_enabled: z.boolean(),
  email_enabled: z.boolean(),
  sms_enabled: z.boolean(),
  digest_hour_local: z.number().int().min(0).max(23),
});

const get = defineRoute(
  {
    method: "get",
    path: "/v1/users/me/notification-prefs",
    operationId: "getNotificationPrefs",
    summary: "Get notification preferences",
    tags: ["Users"],
    auth: "user",
    response: { data: prefsSchema },
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await getPrefs(user.id) };
  },
);

const patch = defineRoute(
  {
    method: "patch",
    path: "/v1/users/me/notification-prefs",
    operationId: "patchNotificationPrefs",
    summary: "Update notification preferences",
    tags: ["Users"],
    auth: "user",
    request: {
      body: z.object({
        push_enabled: z.boolean().optional(),
        email_enabled: z.boolean().optional(),
        sms_enabled: z.boolean().optional(),
        digest_hour_local: z.number().int().min(0).max(23).optional(),
      }),
    },
    response: { data: prefsSchema },
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await setPrefs(user.id, body) };
  },
);

export const GET = get.handler;
export const PATCH = patch.handler;
