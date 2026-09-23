import { z } from "@/lib/zod";
import { defineRoute } from "@/lib/api/route";
import { getOrgProfile } from "@/lib/merchants";

/**
 * Public business profile (PRD §11, invariant #11). No auth — the same shared
 * surface as drop detail. A merchant's Gone drops remain permanently reachable
 * here after they leave the board.
 */
const profileCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  quantity_total: z.number(),
  quantity_remaining: z.number(),
  pct_remaining: z.number(),
  status: z.string(),
  redeem_until: z.string().nullable(),
  gone_at: z.string().nullable(),
});

const route = defineRoute(
  {
    method: "get",
    path: "/v1/orgs/{id}/profile",
    operationId: "getOrgProfile",
    summary: "Public business profile (live + Gone drops)",
    tags: ["Merchant"],
    auth: "none",
    request: { params: z.object({ id: z.uuid() }) },
    response: {
      data: z.object({
        org_id: z.string(),
        name: z.string(),
        logo_url: z.string().nullable(),
        ground_slug: z.string(),
        lane: z.string(),
        redemption_rate: z.number().nullable(),
        locations: z.array(z.object({ name: z.string(), city: z.string(), region: z.string() })),
        live: z.array(profileCardSchema),
        gone: z.array(profileCardSchema),
      }),
    },
    errors: ["NOT_FOUND"],
  },
  async ({ params }) => {
    return { data: await getOrgProfile(params.id) };
  },
);

export const GET = route.handler;
