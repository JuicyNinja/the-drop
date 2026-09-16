import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { recomputeBuyerRiskProfiles } from "@/lib/admin/risk";

/**
 * Recompute buyer risk profiles from catches, transfers, and whispers (admin).
 * A derived, idempotent recompute (like the clout and merchant-score jobs), not
 * an entity decision — it flags for review and never suspends. Production runs
 * this on a schedule.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/admin/fraud/risk/recompute",
    operationId: "adminRecomputeRisk",
    summary: "Recompute buyer risk profiles (admin)",
    tags: ["Admin"],
    auth: "user",
    response: { data: z.object({ profiles: z.number(), flagged: z.number() }) },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await recomputeBuyerRiskProfiles() };
  },
);

export const POST = route.handler;
