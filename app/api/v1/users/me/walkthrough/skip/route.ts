import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { setWalkthroughDone } from "@/lib/auth/walkthrough";

/**
 * First-session walkthrough dismissed. Sets the same column as complete: a
 * walkthrough that can only be completed replays forever for anyone who closes
 * the tab. The distinction is not worth a second field (decision 2026-09-13).
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/users/me/walkthrough/skip",
    operationId: "usersWalkthroughSkip",
    summary: "Skip walkthrough",
    tags: ["Users"],
    auth: "user",
    response: { data: z.object({ walkthrough_completed: z.literal(true) }) },
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await setWalkthroughDone(user.id);
    return { data: { walkthrough_completed: true } };
  },
);

export const POST = route.handler;
