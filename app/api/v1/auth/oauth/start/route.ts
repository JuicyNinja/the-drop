import { z } from "@/lib/zod";
import { defineRoute } from "@/lib/api/route";
import { OAUTH_PROVIDERS, beginOAuth } from "@/lib/auth/identity";

/**
 * API-CONTRACT §2: begin OAuth. Server-side PKCE; the verifier and the
 * validated return_to are held in Redis keyed by a single-use, 10-minute
 * state. The client opens `authorize_url`; the provider returns to the
 * callback with the same state.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/auth/oauth/start",
    operationId: "authOauthStart",
    summary: "Begin OAuth",
    description:
      "Returns the provider authorize URL. return_to is validated as an internal path and preserved through the round trip.",
    tags: ["Auth"],
    auth: "none",
    request: {
      body: z.object({
        provider: z.enum(OAUTH_PROVIDERS),
        return_to: z.string().optional(),
      }),
    },
    response: {
      data: z.object({ authorize_url: z.string(), state: z.string() }),
    },
  },
  async ({ body }) => {
    const result = await beginOAuth(body.provider, body.return_to);
    return { data: result };
  },
);

export const POST = route.handler;
