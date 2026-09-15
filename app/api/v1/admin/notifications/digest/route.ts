import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { isAdmin } from "@/lib/auth/org-access";
import { enqueueDigests } from "@/lib/notifications";

/**
 * The hourly digest job: enqueue the combined daily digest email for every user
 * whose `digest_hour_local` is the current hour (once per user per day). Admin
 * only; production runs it hourly. Enqueue only — the dispatcher sends.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/admin/notifications/digest",
    operationId: "adminRunDigest",
    summary: "Enqueue the hourly digest batch",
    tags: ["Admin"],
    auth: "user",
    response: { data: z.object({ enqueued: z.number() }) },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    if (!(await isAdmin(user))) throw new ApiError("FORBIDDEN", "Admin only.");
    return { data: await enqueueDigests() };
  },
);

export const POST = route.handler;
