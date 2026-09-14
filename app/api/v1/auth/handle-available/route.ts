import { z } from "@/lib/zod";
import { ApiError, isApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { validateHandle } from "@/lib/handles";
import { assertHandleAvailable } from "@/lib/auth/registration";
import { incrementWithWindow } from "@/lib/redis";

/**
 * Handle availability for the registration UI (API-CONTRACT §2).
 *
 * This runs BEFORE a session exists, so it is unauthenticated — an open
 * enumeration surface. Two deliberate constraints:
 *
 *   1. It is rate limited hard by client IP (20 / rolling minute), server-side
 *      in Redis, so it cannot be swept to map the namespace.
 *   2. It returns ONLY `{ available }` — no reason. Taken, reserved, confusable,
 *      and malformed handles are ALL reported the same way (`available: false`),
 *      so the response never reveals which names are special. This preserves
 *      WP-3's rule that reserved handles look exactly like taken ones.
 *
 * Availability is judged on the confusable-normalized form (via
 * assertHandleAvailable), so a handle reported available here will not then be
 * rejected at submit for colliding with an existing account.
 */
const AVAIL_LIMIT_PER_MIN = 20;

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

const route = defineRoute(
  {
    method: "get",
    path: "/v1/auth/handle-available",
    operationId: "authHandleAvailable",
    summary: "Check handle availability (registration)",
    tags: ["Auth"],
    auth: "none",
    request: { query: z.object({ handle: z.string().min(1).max(40) }) },
    response: { data: z.object({ available: z.boolean() }) },
    errors: ["RATE_LIMITED"],
  },
  async ({ query, request }) => {
    const hits = await incrementWithWindow(`handleavail:${clientIp(request)}`, 60);
    if (hits > AVAIL_LIMIT_PER_MIN) throw new ApiError("RATE_LIMITED", "Slow down.");

    const validated = validateHandle(query.handle);
    if (!validated.ok) return { data: { available: false } };
    try {
      await assertHandleAvailable(validated.handle);
      return { data: { available: true } };
    } catch (error) {
      if (isApiError(error) && error.code === "HANDLE_TAKEN") {
        return { data: { available: false } };
      }
      throw error;
    }
  },
);

export const GET = route.handler;
