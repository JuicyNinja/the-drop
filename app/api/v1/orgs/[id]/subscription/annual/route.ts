import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { getOrg } from "@/lib/orgs";
import { requireOwner } from "@/lib/auth/org-access";
import { switchToAnnual } from "@/lib/billing/annual";

/**
 * Switch to an annual contract with the introductory offer (PRD §12.4): $9/month
 * for the first three months, then the annual monthly rate for the remaining
 * nine — one twelve-month term. Behind the same SubscriptionGateway as upgrades;
 * Idempotency-Key is mandatory so a double-click neither charges twice nor starts
 * two terms. Owner/admin. The tier is unchanged (tier changes stay on /upgrade).
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/orgs/{id}/subscription/annual",
    operationId: "switchToAnnual",
    summary: "Switch to an annual contract (with the $9/3-month intro)",
    tags: ["Merchant"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }) },
    response: {
      data: z.object({
        subscription_id: z.string(),
        charged_cents: z.number(),
        billing_interval: z.literal("annual"),
        tier: z.string(),
        annual_price_cents: z.number(),
        annual_monthly_cents: z.number(),
        intro_monthly_cents: z.number(),
        intro_months: z.number(),
        year_total_cents: z.number(),
        annual_started_at: z.string(),
      }),
    },
    errors: ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR", "RATE_LIMITED"],
  },
  async ({ params, request, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, params.id);

    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) {
      throw new ApiError("VALIDATION_ERROR", "Idempotency-Key header is required.", {
        headers: [{ path: "Idempotency-Key", message: "required" }],
      });
    }
    const org = await getOrg(params.id);
    return { data: await switchToAnnual(org, idempotencyKey) };
  },
);

export const POST = route.handler;
