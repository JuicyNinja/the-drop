import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireAdmin } from "@/lib/auth/org-access";
import { adminTagSchema } from "@/lib/api/admin-schemas";
import { ipFromRequest } from "@/lib/admin/audit";
import { listTagsAdmin, createTagAdmin } from "@/lib/admin/taxonomy";

const LANES = ["local", "maker", "digital"] as const;

/** List the full taxonomy (admin), including inactive tags. */
const listRoute = defineRoute(
  {
    method: "get",
    path: "/v1/admin/tags",
    operationId: "adminListTags",
    summary: "List taxonomy (admin)",
    tags: ["Admin"],
    auth: "user",
    response: { data: z.array(adminTagSchema) },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await listTagsAdmin() };
  },
);

/** Create a tag or group (admin). Audited. */
const createRoute = defineRoute(
  {
    method: "post",
    path: "/v1/admin/tags",
    operationId: "adminCreateTag",
    summary: "Create a tag (admin)",
    tags: ["Admin"],
    auth: "user",
    request: {
      body: z.strictObject({
        parent_id: z.uuid().nullable().optional(),
        slug: z.string().min(1).max(80),
        label: z.string().min(1).max(120),
        synonyms: z.array(z.string()).optional(),
        lanes: z.array(z.enum(LANES)).optional(),
        selectable: z.boolean().optional(),
        sort_order: z.number().int().optional(),
      }),
    },
    response: { status: 201, data: adminTagSchema },
    errors: ["FORBIDDEN", "VALIDATION_ERROR"],
  },
  async ({ user, body, request }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireAdmin(user);
    return { data: await createTagAdmin({ actorId: user.id, ip: ipFromRequest(request) }, body) };
  },
);

export const GET = listRoute.handler;
export const POST = createRoute.handler;
