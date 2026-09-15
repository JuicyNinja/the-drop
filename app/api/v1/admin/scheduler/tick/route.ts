import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { isAdmin } from "@/lib/auth/org-access";
import { runClose, runGoLive } from "@/lib/drops";
import { reconcileDrop } from "@/lib/catches";
import { recomputeAllPressure } from "@/lib/board";
import { getServiceClient } from "@/lib/supabase/server";

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
        reconciled: z.number(),
        pressure: z.number(),
      }),
    },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    if (!(await isAdmin(user))) throw new ApiError("FORBIDDEN", "Admin only.");

    const live = await runGoLive();
    const closed = await runClose();

    // Reconcile currently-live drops (60s job): pull quantity_remaining down to
    // match Redis. Never increases it, never writes back to Redis.
    const { data: liveDrops } = await getServiceClient().from("drops").select("id").eq("status", "live");
    let reconciled = 0;
    for (const d of liveDrops ?? []) {
      await reconcileDrop(d.id as string);
      reconciled++;
    }

    // Pressure recompute (60s): pct_remaining for the board, from the reconciled
    // quantity_remaining. Runs after reconcile so it reads the fresh value.
    const pressure = (await recomputeAllPressure()).drops;
    return { data: { went_live: live.went_live, gone: closed.gone, expired: closed.expired, reconciled, pressure } };
  },
);

export const POST = route.handler;
