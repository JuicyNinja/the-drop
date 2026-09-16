import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { listUnverifiedRedemptions } from "@/lib/admin/fraud";

/** Recent unverified (no-fix timeout) redemptions (admin, read-only). */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/admin/fraud/unverified-redemptions",
    operationId: "adminUnverifiedRedemptions",
    summary: "Unverified auto-redemptions (admin)",
    tags: ["Admin"],
    auth: "user",
    response: {
      data: z.array(z.object({
        redemption_id: z.string(), user_id: z.string(), user_handle: z.string(),
        drop_title: z.string(), redeemed_at: z.string(),
      })),
    },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await listUnverifiedRedemptions() };
  },
);

export const GET = route.handler;
