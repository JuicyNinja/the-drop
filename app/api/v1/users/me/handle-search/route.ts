import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { validateHandle } from "@/lib/handles";
import { assertHandleAvailable } from "@/lib/auth/registration";
import { incrementWithWindow } from "@/lib/redis";
import { isApiError } from "@/lib/api/errors";

/**
 * Handle availability for the registration UI. Rate limited 60/min per user
 * (API-CONTRACT §13). Reserved and taken handles both report unavailable
 * without revealing which are reserved.
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/users/me/handle-search",
    operationId: "usersHandleSearch",
    summary: "Check handle availability",
    tags: ["Users"],
    auth: "user",
    request: { query: z.object({ handle: z.string().min(1).max(40) }) },
    response: {
      data: z.object({
        available: z.boolean(),
        reason: z.string().nullable(),
      }),
    },
    errors: ["RATE_LIMITED"],
  },
  async ({ query, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    const hits = await incrementWithWindow(`handlesearch:${user.id}`, 60);
    if (hits > 60) throw new ApiError("RATE_LIMITED", "Slow down.");

    const validated = validateHandle(query.handle);
    if (!validated.ok) {
      return { data: { available: false, reason: validated.problem.rule } };
    }
    try {
      await assertHandleAvailable(validated.handle);
      return { data: { available: true, reason: null } };
    } catch (error) {
      if (isApiError(error) && error.code === "HANDLE_TAKEN") {
        return { data: { available: false, reason: "taken" } };
      }
      throw error;
    }
  },
);

export const GET = route.handler;
