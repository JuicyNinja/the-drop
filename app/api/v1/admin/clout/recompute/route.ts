import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { isAdmin } from "@/lib/auth/org-access";
import { recomputeAllClout } from "@/lib/clout";

/**
 * The hourly clout recompute (API-CONTRACT §9 / DATA-MODEL §18). Decay,
 * percentile, and tiers are derived from the append-only ledger; running this
 * twice in the same hour produces identical scores (deterministic + idempotent).
 * Admin only; production trigger is an Upstash/QStash hourly schedule.
 *
 * This is NOT a clout write path — it materializes scores FROM the ledger and
 * cannot mint clout. There is no admin grant endpoint anywhere.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/admin/clout/recompute",
    operationId: "adminCloutRecompute",
    summary: "Recompute clout scores (hourly job)",
    tags: ["Admin"],
    auth: "user",
    response: {
      data: z.object({
        reference_hour: z.string(),
        cities: z.number(),
        users: z.number(),
        tier5_by_city: z.record(z.string(), z.object({ active_users: z.number(), tier5: z.number() })),
        // Expected 0. Above 0 = clout events that joined no city leaderboard.
        skipped_no_city: z.number(),
      }),
    },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    if (!(await isAdmin(user))) throw new ApiError("FORBIDDEN", "Admin only.");
    return { data: await recomputeAllClout() };
  },
);

export const POST = route.handler;
