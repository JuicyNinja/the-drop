import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { sendPhoneCode } from "@/lib/auth/phone";

/** API-CONTRACT §2: (re)send the SMS verification code. Rate limited 5/hr per phone. */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/auth/phone/verify/send",
    operationId: "authPhoneVerifySend",
    summary: "Send phone verification code",
    tags: ["Auth"],
    auth: "user",
    response: { data: z.object({ sent: z.literal(true) }) },
    errors: ["RATE_LIMITED"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await sendPhoneCode(user.id, user.phone);
    return { data: { sent: true } };
  },
);

export const POST = route.handler;
