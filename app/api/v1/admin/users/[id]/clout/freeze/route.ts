import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { adminUserSchema } from "@/lib/api/admin-schemas";
import { ipFromRequest } from "@/lib/admin/audit";
import { setCloutFrozen } from "@/lib/admin/users";

/**
 * Freeze or unfreeze a user's clout accrual (admin). `frozen` defaults true; pass
 * false to unfreeze. This never grants or removes earned clout — there is no
 * grant path (invariant #6); freeze only stops future accrual. Audited.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/admin/users/{id}/clout/freeze",
    operationId: "adminFreezeClout",
    summary: "Freeze or unfreeze clout accrual (admin)",
    tags: ["Admin"],
    auth: "user",
    request: {
      params: z.object({ id: z.uuid() }),
      body: z.strictObject({ frozen: z.boolean().optional() }).optional(),
    },
    response: { data: adminUserSchema },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ user, params, body, request }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    const frozen = body?.frozen ?? true;
    return { data: await setCloutFrozen({ actorId: user.id, ip: ipFromRequest(request) }, params.id, frozen) };
  },
);

export const POST = route.handler;
