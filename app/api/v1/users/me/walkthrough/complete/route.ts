import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { setWalkthroughDone } from "@/lib/auth/walkthrough";

/** First-session walkthrough finished. Sets walkthrough_completed_at. */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/users/me/walkthrough/complete",
    operationId: "usersWalkthroughComplete",
    summary: "Mark walkthrough complete",
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
