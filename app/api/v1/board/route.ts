import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { getBoard } from "@/lib/board";

/**
 * API-CONTRACT §4: the landing board. On Fire + New per lane, ranked by
 * `pct_remaining` ascending (a percentage, never a count). An optional `tag_id`
 * filters to a category (ranking runs within the filtered set); an optional
 * `sort` reorders On Fire (heat | distance | ending). `meta.ranking` reports
 * whether the city is in cold-start fallback — for telemetry, not display.
 */
const dropCardSchema = z.object({
  id: z.string(),
  lane: z.string(),
  title: z.string(),
  image_url: z.string().nullable(),
  quantity_total: z.number(),
  quantity_remaining: z.number(),
  pct_remaining: z.number(),
  price_cents: z.number().nullable(),
  live_until: z.string().nullable(),
  redeem_until: z.string().nullable(),
  status: z.string(),
  merchant: z.object({ org_id: z.string(), name: z.string(), redemption_rate: z.number().nullable() }),
});
const laneSchema = z.object({ on_fire: z.array(dropCardSchema), new: z.array(dropCardSchema), gone: z.array(dropCardSchema) });

const route = defineRoute(
  {
    method: "get",
    path: "/v1/board",
    operationId: "getBoard",
    summary: "The landing board (On Fire + New per lane)",
    tags: ["Board"],
    auth: "user",
    request: {
      query: z.object({
        address_id: z.uuid().optional(),
        tag_id: z.uuid().optional(),
        sort: z.enum(["heat", "distance", "ending"]).optional(),
      }),
    },
    response: {
      data: z.object({ local: laneSchema, maker: laneSchema, digital: laneSchema }),
    },
    errors: ["NOT_FOUND"],
  },
  async ({ query, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    const board = await getBoard(user.id, { addressId: query.address_id, tagId: query.tag_id, sort: query.sort });
    return { data: board.data as unknown as { local: z.infer<typeof laneSchema>; maker: z.infer<typeof laneSchema>; digital: z.infer<typeof laneSchema> }, meta: board.meta };
  },
);

export const GET = route.handler;
