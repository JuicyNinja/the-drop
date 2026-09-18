import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { getTagTree } from "@/lib/tags";

/**
 * API-CONTRACT §8: the platform taxonomy tree for the filter picker. Groups
 * (browsable chips, never selectable) with their selectable leaves. Read-only
 * for all non-admin roles; there is no free-text tag entry.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/tags",
    operationId: "listTags",
    summary: "The category taxonomy tree",
    tags: ["Board"],
    auth: "user",
    request: { query: z.object({ lane: z.enum(["local", "maker", "digital"]).optional() }) },
    response: {
      data: z.array(
        z.object({
          id: z.string(),
          slug: z.string(),
          label: z.string(),
          ground_hex: z.string().nullable(),
          leaves: z.array(z.object({ id: z.string(), label: z.string(), slug: z.string() })),
        }),
      ),
    },
  },
  async ({ query, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await getTagTree(query.lane) };
  },
);

export const GET = route.handler;
