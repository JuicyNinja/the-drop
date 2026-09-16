import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { adminUserSchema } from "@/lib/api/admin-schemas";
import { ipFromRequest } from "@/lib/admin/audit";
import { setUserSuspended } from "@/lib/admin/users";

/** Suspend or reinstate a buyer (admin). `suspended` defaults true; pass false to
 *  reinstate. Audited. */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/admin/users/{id}/suspend",
    operationId: "adminSuspendUser",
    summary: "Suspend or reinstate a user (admin)",
    tags: ["Admin"],
    auth: "user",
    request: {
      params: z.object({ id: z.uuid() }),
      body: z.strictObject({ suspended: z.boolean().optional() }).optional(),
    },
    response: { data: adminUserSchema },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ user, params, body, request }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    const suspended = body?.suspended ?? true;
    return { data: await setUserSuspended({ actorId: user.id, ip: ipFromRequest(request) }, params.id, suspended) };
  },
);

export const POST = route.handler;
