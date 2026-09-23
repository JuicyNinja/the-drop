import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { dropResponseSchema, patchDropSchema } from "@/lib/api/drop-schemas";
import { cancelDrop, getDrop, patchDraft, scheduleDrop } from "@/lib/drops";
import { orgIdForDrop, requireOwner } from "@/lib/auth/org-access";
import { getPublicDrop } from "@/lib/board";
import { verifySession } from "@/lib/auth/session";

/**
 * Edit or transition a drop. Owner/admin only.
 *   status: "scheduled" → schedule (consumes allowance; 402 at cap)
 *   status: "draft"     → cancel back to draft (allowance NOT restored)
 *   field edits         → allowed on draft/scheduled; a live drop is
 *                         DROP_IMMUTABLE (enforced by DB trigger).
 */
const route = defineRoute(
  {
    method: "patch",
    path: "/v1/drops/{id}",
    operationId: "patchDrop",
    summary: "Edit or schedule a drop",
    tags: ["Drops"],
    auth: "user",
    request: { params: z.object({ id: z.uuid() }), body: patchDropSchema },
    response: { data: dropResponseSchema },
    errors: ["FORBIDDEN", "NOT_FOUND", "DROP_IMMUTABLE", "ALLOWANCE_EXHAUSTED", "VALIDATION_ERROR"],
  },
  async ({ params, body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForDrop(params.id));

    const { status, ...fields } = body;

    if (Object.keys(fields).length > 0) {
      await patchDraft(params.id, fields);
    }
    if (status === "scheduled") return { data: await scheduleDrop(params.id) };
    if (status === "draft") return { data: await cancelDrop(params.id) };
    return { data: await getDrop(params.id) };
  },
);

export const PATCH = route.handler;

/**
 * API-CONTRACT §4: public drop detail — the shared-link surface. No auth
 * required; an optional bearer lets `can_catch` reflect the viewer's state.
 * `can_catch` is server-computed and is a display hint only — POST /v1/catches
 * (Redis) remains the sole authority on whether a catch actually succeeds.
 */
const publicDropSchema = z.object({
  id: z.string(),
  lane: z.string(),
  title: z.string(),
  description: z.string(),
  terms: z.string().nullable(),
  image_urls: z.array(z.string()),
  quantity_remaining: z.number(),
  quantity_total: z.number(),
  pct_remaining: z.number(),
  price_cents: z.number().nullable(),
  live_until: z.string().nullable(),
  redeem_from: z.string().nullable(),
  redeem_until: z.string().nullable(),
  redeem_window: z.string(),
  status: z.string(),
  ground_slug: z.string(),
  merchant: z.object({
    org_id: z.string(),
    name: z.string(),
    logo_url: z.string().nullable(),
    redemption_rate: z.number().nullable(),
    location: z.object({ name: z.string(), city: z.string(), lat: z.number(), lng: z.number() }).nullable(),
  }),
  can_catch: z.boolean(),
  catch_blocked_reason: z.string().nullable(),
});

const getRoute = defineRoute(
  {
    method: "get",
    path: "/v1/drops/{id}",
    operationId: "getPublicDrop",
    summary: "Public drop detail (shared-link surface)",
    tags: ["Drops"],
    auth: "none",
    request: { params: z.object({ id: z.uuid() }) },
    response: { data: publicDropSchema },
    errors: ["NOT_FOUND"],
  },
  async ({ params, request }) => {
    // Optional viewer: a valid bearer refines can_catch; its absence or
    // invalidity simply yields can_catch=false, reason UNAUTHENTICATED.
    let viewerId: string | null = null;
    if (request.headers.get("authorization")) {
      try {
        viewerId = (await verifySession(request)).authUserId;
      } catch {
        viewerId = null;
      }
    }
    return { data: await getPublicDrop(params.id, viewerId) };
  },
);

export const GET = getRoute.handler;
