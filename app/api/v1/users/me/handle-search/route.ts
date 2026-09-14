import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { incrementWithWindow } from "@/lib/redis";
import { searchHandles } from "@/lib/users";

/**
 * Handle autocomplete for the transfer send flow (API-CONTRACT §7).
 *
 * This is a user-enumeration surface. Three controls, together, make it useless
 * for testing whether a given handle exists at volume:
 *   1. A minimum query length of 2 (no single-character probing).
 *   2. A hard per-user rate limit (30 / rolling minute), enforced server-side in
 *      Redis so a fresh request cannot reset it. Bulk sweeping trips it.
 *   3. The response carries ONLY handle and display name — never the user
 *      number, city, phone, or email.
 * The caller is excluded from results (you cannot send a catch to yourself).
 *
 * (Registration availability — the old purpose of this path — moved to the
 * unauthenticated GET /v1/auth/handle-available.)
 */
const SEARCH_LIMIT_PER_MIN = 30;

const route = defineRoute(
  {
    method: "get",
    path: "/v1/users/me/handle-search",
    operationId: "usersHandleSearch",
    summary: "Autocomplete handles for the send flow",
    tags: ["Transfers"],
    auth: "user",
    request: { query: z.object({ q: z.string().min(2).max(40) }) },
    response: {
      data: z.array(z.object({ handle: z.string(), display_name: z.string() })),
    },
    errors: ["RATE_LIMITED"],
  },
  async ({ query, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    const hits = await incrementWithWindow(`handlesearch:${user.id}`, 60);
    if (hits > SEARCH_LIMIT_PER_MIN) throw new ApiError("RATE_LIMITED", "Slow down.");
    return { data: await searchHandles(query.q, user.id) };
  },
);

export const GET = route.handler;
