import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { addPushSubscription } from "@/lib/notifications";

/**
 * API-CONTRACT §9: register a Web Push subscription for the caller's device.
 * The dispatcher sends `push` notifications to each of a user's subscriptions.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/users/me/push-subscriptions",
    operationId: "addPushSubscription",
    summary: "Register a Web Push subscription",
    tags: ["Users"],
    auth: "user",
    request: {
      body: z.object({
        endpoint: z.url(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      }),
    },
    response: { status: 201, data: z.object({ id: z.string() }) },
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await addPushSubscription(user.id, body.endpoint, body.keys) };
  },
);

export const POST = route.handler;
