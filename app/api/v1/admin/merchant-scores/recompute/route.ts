import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { isAdmin } from "@/lib/auth/org-access";
import { recomputeMerchantScores } from "@/lib/merchant-score";

/**
 * The daily merchant-score recompute (API-CONTRACT §10 / DATA-MODEL §18).
 * Trailing redemption rate + whisper score, with new/insufficient merchants
 * seeded at the cohort median. Deterministic within a day. Admin only;
 * production trigger is an Upstash/QStash daily schedule.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/admin/merchant-scores/recompute",
    operationId: "adminMerchantScoreRecompute",
    summary: "Recompute merchant scores (daily job)",
    tags: ["Admin"],
    auth: "user",
    response: {
      data: z.object({
        orgs: z.number(),
        cohort_median: z.number().nullable(),
        seeded_at_median: z.number(),
      }),
    },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    if (!(await isAdmin(user))) throw new ApiError("FORBIDDEN", "Admin only.");
    return { data: await recomputeMerchantScores() };
  },
);

export const POST = route.handler;
