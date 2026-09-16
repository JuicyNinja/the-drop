import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { riskProfileSchema } from "@/lib/api/admin-schemas";
import { listFlaggedRiskProfiles } from "@/lib/admin/risk";

/** Buyers currently flagged for review (admin only, read-only). Flags are a
 *  prompt for a human, never an automatic action. */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/admin/fraud/risk",
    operationId: "adminListFlaggedRisk",
    summary: "Flagged buyer risk profiles (admin only)",
    tags: ["Admin"],
    auth: "user",
    response: { data: z.array(riskProfileSchema) },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await listFlaggedRiskProfiles() };
  },
);

export const GET = route.handler;
