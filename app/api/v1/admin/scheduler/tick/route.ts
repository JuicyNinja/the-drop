import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { isAdmin } from "@/lib/auth/org-access";
import { runClose, runGoLive } from "@/lib/drops";

/**
 * Run one scheduler tick: go-live (scheduled → live, seed Redis) and close
 * (live → gone|expired). In production an external ticker calls this every ~15s
 * (Vercel cron is 1/min max, so the 15s cadence needs a small worker or an
 * Upstash/QStash schedule). Admin only.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/admin/scheduler/tick",
    operationId: "adminSchedulerTick",
    summary: "Run one scheduler tick",
    tags: ["Admin"],
    auth: "user",
    response: {
      data: z.object({
        went_live: z.array(z.string()),
        gone: z.array(z.string()),
        expired: z.array(z.string()),
      }),
    },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    if (!(await isAdmin(user))) throw new ApiError("FORBIDDEN", "Admin only.");

    const live = await runGoLive();
    const closed = await runClose();
    return { data: { went_live: live.went_live, gone: closed.gone, expired: closed.expired } };
  },
);

export const POST = route.handler;
