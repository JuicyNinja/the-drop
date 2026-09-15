import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { searchTags } from "@/lib/tags";

/**
 * API-CONTRACT §8: category type-ahead. Matches label and synonyms over the
 * platform taxonomy — NEVER drop titles or descriptions. Minimum 2 characters.
 * Runs through the `tags_search` GIN index (via the `search_tags` function).
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/tags/search",
    operationId: "searchTags",
    summary: "Category type-ahead",
    tags: ["Board"],
    auth: "user",
    request: {
      query: z.object({
        q: z.string().min(2).max(60),
        lane: z.enum(["local", "maker", "digital"]).optional(),
      }),
    },
    response: {
      data: z.array(z.object({ id: z.string(), label: z.string(), group: z.string(), matched_on: z.string() })),
    },
  },
  async ({ query, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    return { data: await searchTags(query.q, query.lane) };
  },
);

export const GET = route.handler;
