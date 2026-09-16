import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { adminTagSchema } from "@/lib/api/admin-schemas";
import { ipFromRequest } from "@/lib/admin/audit";
import { patchTagAdmin } from "@/lib/admin/taxonomy";

const LANES = ["local", "maker", "digital"] as const;

/** Edit a tag (admin): label, synonyms, lanes, active, sort order. Audited. */
const route = defineRoute(
  {
    method: "patch",
    path: "/v1/admin/tags/{id}",
    operationId: "adminPatchTag",
    summary: "Edit a tag (admin)",
    tags: ["Admin"],
    auth: "user",
    request: {
      params: z.object({ id: z.uuid() }),
      body: z.strictObject({
        label: z.string().min(1).max(120).optional(),
        synonyms: z.array(z.string()).optional(),
        lanes: z.array(z.enum(LANES)).optional(),
        active: z.boolean().optional(),
        sort_order: z.number().int().optional(),
      }),
    },
    response: { data: adminTagSchema },
    errors: ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"],
  },
  async ({ user, params, body, request }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await patchTagAdmin({ actorId: user.id, ip: ipFromRequest(request) }, params.id, body) };
  },
);

export const PATCH = route.handler;
