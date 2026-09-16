import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { listVelocityFlags } from "@/lib/admin/fraud";

/** Accounts with high unverified auto-redemption velocity (admin, read-only). */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/admin/fraud/velocity-flags",
    operationId: "adminVelocityFlags",
    summary: "Velocity flags (admin)",
    tags: ["Admin"],
    auth: "user",
    response: {
      data: z.array(z.object({
        user_id: z.string(), user_handle: z.string(), unverified_30d: z.number(), limit: z.number(),
      })),
    },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await listVelocityFlags() };
  },
);

export const GET = route.handler;
