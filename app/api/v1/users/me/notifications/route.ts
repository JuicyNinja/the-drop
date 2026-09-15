import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { listUserNotifications } from "@/lib/notifications";

/**
 * API-CONTRACT §9: the caller's notification history (the in-app feed). in_app
 * notifications are delivered simply by being queryable here.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/users/me/notifications",
    operationId: "listMyNotifications",
    summary: "The caller's notifications",
    tags: ["Users"],
    auth: "user",
    response: {
      data: z.array(
        z.object({
          id: z.string(),
          kind: z.string(),
          channel: z.string(),
          payload: z.record(z.string(), z.unknown()),
          read_at: z.string().nullable(),
          created_at: z.string(),
        }),
      ),
    },
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await listUserNotifications(user.id) };
  },
);

export const GET = route.handler;
