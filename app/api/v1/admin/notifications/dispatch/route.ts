import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { isAdmin } from "@/lib/auth/org-access";
import { dispatchPending } from "@/lib/notifications";

/**
 * Drain the notification queue: send pending rows through the SMS / email / push
 * providers, exactly once each. This is SEPARATE from the enqueue side so a slow
 * or failing provider can never block go-live or any other triggering event.
 * Admin only; production runs it on its own frequent cron cadence.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/admin/notifications/dispatch",
    operationId: "adminDispatchNotifications",
    summary: "Send pending notifications",
    tags: ["Admin"],
    auth: "user",
    response: { data: z.object({ sent: z.number(), failed: z.number(), skipped: z.number() }) },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    if (!(await isAdmin(user))) throw new ApiError("FORBIDDEN", "Admin only.");
    return { data: await dispatchPending() };
  },
);

export const POST = route.handler;
