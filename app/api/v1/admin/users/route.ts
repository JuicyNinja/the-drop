import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { adminUserSchema } from "@/lib/api/admin-schemas";
import { listUsersAdmin } from "@/lib/admin/users";

/** List users (admin). Optional handle/name/email search. */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/admin/users",
    operationId: "adminListUsers",
    summary: "List users (admin)",
    tags: ["Admin"],
    auth: "user",
    request: { query: z.object({ q: z.string().optional() }) },
    response: { data: z.array(adminUserSchema) },
    errors: ["FORBIDDEN"],
  },
  async ({ user, query }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await listUsersAdmin({ q: query.q }) };
  },
);

export const GET = route.handler;
