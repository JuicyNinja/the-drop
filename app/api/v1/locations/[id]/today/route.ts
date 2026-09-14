import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { getTodayScreen } from "@/lib/today";
import { requireLocationAccess } from "@/lib/auth/org-access";

/**
 * API-CONTRACT §10: Today's Code. The merchant counter screen — the code per
 * live drop with phonetic guidance, and the live redemption feed with
 * unverified marks. The only merchant surface staff may reach (owner/admin too).
 */
const route = defineRoute(
  {
    method: "get",
    path: "/v1/locations/{id}/today",
    operationId: "getLocationToday",
    summary: "Today's Code (merchant counter screen)",
    tags: ["Merchant"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: {
      data: z.object({
        codes: z.array(
          z.object({
            drop_id: z.string(),
            code: z.string(),
            phonetic: z.string(),
            title: z.string(),
            redeem_until: z.string().nullable(),
          }),
        ),
        feed: z.array(
          z.object({
            handle: z.string(),
            position_number: z.number(),
            method: z.string(),
            unverified: z.boolean(),
            at: z.string(),
          }),
        ),
      }),
    },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireLocationAccess(user, params.id);
    return { data: await getTodayScreen(params.id) };
  },
);

export const GET = route.handler;
