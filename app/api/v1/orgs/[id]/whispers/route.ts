import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { requireOwner } from "@/lib/auth/org-access";
import { listOrgWhispers } from "@/lib/whispers";

/**
 * API-CONTRACT §9: whispers for an org. **Merchant owner and admin only.
 * Read-only. Never public.** Staff cannot read whispers. Buyer identity is
 * omitted from the merchant view (see lib/whispers). RLS is the second layer:
 * even if this gate were wrong, whispers_select would refuse a stranger.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/orgs/{id}/whispers",
    operationId: "listOrgWhispers",
    summary: "Whispers for an org (owner/admin)",
    tags: ["Clout"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: {
      data: z.array(
        z.object({
          id: z.string(),
          would_return_at_full_price: z.boolean(),
          dim_2: z.number(),
          dim_3: z.number(),
          dim_4: z.number(),
          note: z.string().nullable(),
          drop_title: z.string(),
          created_at: z.string(),
        }),
      ),
    },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    // Owner or admin only — staff is excluded (contract §9).
    await requireOwner(user, params.id);
    return { data: await listOrgWhispers(params.id) };
  },
);

export const GET = route.handler;
