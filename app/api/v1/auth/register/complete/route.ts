import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { addressInputSchema } from "@/lib/api/auth-schemas";
import { completeRegistration } from "@/lib/auth/registration";
import { sendPhoneCode } from "@/lib/auth/phone";
import { getEmailSender } from "@/lib/email";
import { formatUserNumber } from "@/lib/users";

/**
 * API-CONTRACT §2: collect the fields OAuth does not supply, assign the
 * user_number, set the Home + active address, and trigger SMS verification.
 * The full profile (tags, more addresses, Fanatics) is deferred to the
 * post-registration email prompt — not a signup blocker (PRD §3.5).
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/auth/register/complete",
    operationId: "authRegisterComplete",
    summary: "Complete registration",
    description:
      "Collects name, handle, phone, and address; assigns user_number; sends the SMS code and the profile-completion email.",
    tags: ["Auth"],
    auth: "session",
    request: {
      body: z.object({
        full_name: z.string().min(1).max(200),
        handle: z.string().min(3).max(20),
        phone: z.string().min(8).max(20),
        address: addressInputSchema,
      }),
    },
    response: {
      data: z.object({
        user_number: z.string(),
        user_number_display: z.string(),
        handle: z.string(),
        phone_verification_sent: z.boolean(),
      }),
    },
    errors: ["HANDLE_TAKEN", "VALIDATION_ERROR"],
  },
  async ({ body, authUserId, authEmail }) => {
    if (!authUserId || !authEmail) {
      throw new ApiError("UNAUTHENTICATED", "No authenticated identity.");
    }

    const user = await completeRegistration(authUserId, authEmail, {
      full_name: body.full_name,
      handle: body.handle,
      phone: body.phone,
      address: body.address,
    });

    await sendPhoneCode(user.id, user.phone);

    // Post-registration prompt to finish the full profile. Provider dev mode
    // logs it; Resend sends it. Failure here must not fail registration.
    try {
      await getEmailSender().send({
        to: user.email,
        subject: "Finish setting up your profile",
        text: "Your account is ready. Add your preferences, extra addresses, and Fanatics whenever you like.",
      });
    } catch (error) {
      console.error("[register] profile email failed", error);
    }

    return {
      data: {
        user_number: user.user_number,
        user_number_display: formatUserNumber(user.user_number),
        handle: user.handle,
        phone_verification_sent: true,
      },
    };
  },
);

export const POST = route.handler;
