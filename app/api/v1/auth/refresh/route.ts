import { z } from "@/lib/zod";
import { defineRoute } from "@/lib/api/route";
import { sessionSchema } from "@/lib/api/auth-schemas";
import { refreshSession } from "@/lib/auth/mint";

/**
 * API-CONTRACT §2: rotate a refresh token. Delegated to GoTrue, which has
 * refresh-token rotation and reuse detection enabled: each call returns a new
 * token, and replaying a rotated token past the reuse interval revokes the
 * family and forces re-auth. The access token lives in client memory only.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/auth/refresh",
    operationId: "authRefresh",
    summary: "Refresh session",
    description: "Exchanges a refresh token for a rotated session.",
    tags: ["Auth"],
    auth: "none",
    request: { body: z.object({ refresh_token: z.string().min(1) }) },
    response: { data: z.object({ session: sessionSchema }) },
    errors: ["UNAUTHENTICATED"],
  },
  async ({ body }) => {
    const session = await refreshSession(body.refresh_token);
    return { data: { session } };
  },
);

export const POST = route.handler;
