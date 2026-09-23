import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { dropResponseSchema } from "@/lib/api/drop-schemas";
import { duplicateDrop, bulkDuplicateSchedule } from "@/lib/drops";
import { orgIdForDrop, requireOwner } from "@/lib/auth/org-access";

/**
 * Duplicate a drop. Owner/admin only.
 *
 * No body (or empty schedule_at) → one new draft, all fields editable, allowance
 * consumed only when it is later scheduled (the original behaviour).
 *
 * `schedule_at: string[]` → BULK: schedule one copy per go-live date in a single
 * action (e.g. the four Tuesdays). Still duplicate, not a recurrence rule — N
 * discrete scheduled copies. All-or-nothing on the allowance cap: the whole
 * batch fits or nothing is created.
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/drops/{id}/duplicate",
    operationId: "duplicateDrop",
    summary: "Duplicate a drop, or bulk-schedule copies to dates",
    description: "No body: clones to a new draft (allowance consumed when scheduled). With schedule_at[]: schedules one copy per date, all-or-nothing on the allowance cap.",
    tags: ["Drops"],
    auth: "user",
    request: {
      params: z.object({ id: z.uuid() }),
      body: z
        .object({ schedule_at: z.array(z.string().datetime()).min(1).max(52).optional() })
        .optional(),
    },
    response: {
      status: 201,
      data: dropResponseSchema.or(z.object({ drops: z.array(dropResponseSchema) })),
    },
    errors: ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR", "ALLOWANCE_EXHAUSTED"],
  },
  async ({ params, body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, await orgIdForDrop(params.id));
    const dates = body?.schedule_at;
    if (dates && dates.length > 0) {
      return { data: { drops: await bulkDuplicateSchedule(params.id, user.id, dates) } };
    }
    return { data: await duplicateDrop(params.id, user.id) };
  },
);

export const POST = route.handler;
