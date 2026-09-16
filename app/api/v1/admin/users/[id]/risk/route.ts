import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { riskProfileSchema } from "@/lib/api/admin-schemas";
import { getRiskProfile } from "@/lib/admin/risk";

/**
 * One buyer's risk profile (admin only). INTERNAL — never public, never
 * merchant-facing. This route is admin-gated and the table's RLS denies every
 * other role as a second wall (gate item 4). It flags for review; it never
 * suspends.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/admin/users/{id}/risk",
    operationId: "adminGetUserRisk",
    summary: "A buyer's risk profile (admin only)",
    tags: ["Admin"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: { data: riskProfileSchema },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ user, params }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await getRiskProfile(params.id) };
  },
);

export const GET = route.handler;
