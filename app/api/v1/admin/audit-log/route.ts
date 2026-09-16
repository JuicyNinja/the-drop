import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { listAuditLog } from "@/lib/admin/audit-log";

/** Read the admin audit trail (admin). Read-only; the table is append-only at the
 *  database layer. Optional filters by actor, target type, and target id. */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/admin/audit-log",
    operationId: "adminAuditLog",
    summary: "Admin audit log (admin)",
    tags: ["Admin"],
    auth: "user",
    request: {
      query: z.object({
        actor_id: z.uuid().optional(),
        target_type: z.string().optional(),
        target_id: z.uuid().optional(),
      }),
    },
    response: {
      data: z.array(z.object({
        id: z.string(), actor_id: z.string(), actor_handle: z.string(), action: z.string(),
        target_type: z.string(), target_id: z.string().nullable(),
        before: z.unknown(), after: z.unknown(), ip_address: z.string().nullable(),
        occurred_at: z.string(),
      })),
    },
    errors: ["FORBIDDEN"],
  },
  async ({ user, query }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await listAuditLog({ actor_id: query.actor_id, target_type: query.target_type, target_id: query.target_id }) };
  },
);

export const GET = route.handler;
