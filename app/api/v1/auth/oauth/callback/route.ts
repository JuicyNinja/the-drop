import { z } from "@/lib/zod";
import { defineRoute } from "@/lib/api/route";
import { sessionSchema } from "@/lib/api/auth-schemas";
import { resolveOAuthCallback } from "@/lib/auth/identity";
import { mintSessionForEmail } from "@/lib/auth/mint";
import { registrationStatus } from "@/lib/auth/registration";

/**
 * API-CONTRACT §2: exchange an OAuth code for a session. Consumes the
 * single-use state, exchanges the code for an identity, mints our session, and
 * reports whether registration is complete along with return_to — which the
 * client MUST honor so a user from a shared drop link returns to that exact
 * drop.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/auth/oauth/callback",
    operationId: "authOauthCallback",
    summary: "OAuth callback",
    description: "Exchanges code + state for a session and the return_to intent.",
    tags: ["Auth"],
    auth: "none",
    request: {
      body: z.object({ code: z.string().min(1), state: z.string().min(1) }),
    },
    response: {
      data: z.object({
        session: sessionSchema,
        registration_complete: z.boolean(),
        missing_fields: z.array(z.string()),
        return_to: z.string(),
      }),
    },
    errors: ["VALIDATION_ERROR"],
  },
  async ({ body }) => {
    const { identity, returnTo } = await resolveOAuthCallback(body.code, body.state);
    const minted = await mintSessionForEmail(identity.email);
    const status = await registrationStatus(minted.authUserId);
    return {
      data: {
        session: minted.session,
        registration_complete: status.registration_complete,
        missing_fields: status.missing_fields,
        return_to: returnTo,
      },
    };
  },
);

export const POST = route.handler;
