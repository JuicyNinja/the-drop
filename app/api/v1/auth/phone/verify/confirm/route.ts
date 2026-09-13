import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { confirmPhoneCode } from "@/lib/auth/phone";
import { getServiceClient } from "@/lib/supabase/server";

/** API-CONTRACT §2: confirm the SMS code and set phone_verified_at. */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/auth/phone/verify/confirm",
    operationId: "authPhoneVerifyConfirm",
    summary: "Confirm phone verification code",
    tags: ["Auth"],
    auth: "user",
    request: { body: z.object({ code: z.string().min(4).max(10) }) },
    response: { data: z.object({ phone_verified: z.literal(true) }) },
    errors: ["VALIDATION_ERROR"],
  },
  async ({ body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await confirmPhoneCode(user.id, body.code);
    const { error } = await getServiceClient()
      .from("users")
      .update({ phone_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (error) throw new Error(`set phone_verified failed: ${error.message}`);
    return { data: { phone_verified: true } };
  },
);

export const POST = route.handler;
