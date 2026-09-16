import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";

/**
 * Upcoming picks — a v1 STUB (BUILD-PLAN WP-14: "tab exists, lanes do not"). The
 * endpoint exists so the contract and the admin tab are stable, but there is no
 * Upcoming lane on the board in v1, so this stores nothing and mutates nothing —
 * hence no audit entry (there is no change to record). It is a deliberate no-op,
 * not a 501: the release gate forbids any NOT_IMPLEMENTED response.
 */
const route = defineRoute(
  {
    method: "put",
    path: "/v1/admin/board/upcoming",
    operationId: "adminSetUpcoming",
    summary: "Set Upcoming picks (v1 stub)",
    tags: ["Admin"],
    auth: "user",
    request: { body: z.strictObject({ drop_ids: z.array(z.uuid()).optional() }).optional() },
    response: { data: z.object({ live: z.boolean(), message: z.string() }) },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: { live: false, message: "Upcoming picks are not live in v1. The tab and endpoint exist; the board has no Upcoming lane yet." } };
  },
);

export const PUT = route.handler;
