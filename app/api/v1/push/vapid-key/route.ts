import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { getEnv } from "@/lib/env";

/**
 * The VAPID public key the browser needs to create a Web Push subscription
 * (`applicationServerKey`). It is public by definition. Null when push is not
 * configured for this environment (dev without VAPID keys) — the client then
 * degrades gracefully rather than failing to subscribe.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/push/vapid-key",
    operationId: "getVapidKey",
    summary: "Web Push VAPID public key",
    tags: ["Users"],
    auth: "user",
    response: { data: z.object({ key: z.string().nullable() }) },
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: { key: getEnv().VAPID_PUBLIC_KEY ?? null } };
  },
);

export const GET = route.handler;
