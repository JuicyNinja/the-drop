import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { addStaffSchema } from "@/lib/api/org-schemas";
import { addStaff, listStaff } from "@/lib/orgs";
import { requireOwner } from "@/lib/auth/org-access";

const params = z.object({ id: z.uuid() });
const staffSeat = z.object({ user_id: z.string(), location_id: z.string(), granted_at: z.string() });

/** List staff seats. Owner/admin only. */
const listRoute = defineRoute(
  {
    method: "get",
    path: "/v1/orgs/{id}/staff",
    operationId: "listOrgStaff",
    summary: "List staff",
    tags: ["Merchant"],
    auth: "user",
    request: { params },
    response: { data: z.object({ staff: z.array(staffSeat) }) },
    errors: ["FORBIDDEN", "NOT_FOUND"],
  },
  async ({ params: p, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, p.id);
    return { data: { staff: await listStaff(p.id) } };
  },
);

/** Add a staff seat, scoped to a single location. Owner/admin only. */
const createRoute = defineRoute(
  {
    method: "post",
    path: "/v1/orgs/{id}/staff",
    operationId: "addOrgStaff",
    summary: "Add a staff seat",
    tags: ["Merchant"],
    auth: "user",
    request: { params, body: addStaffSchema },
    response: { status: 201, data: staffSeat },
    errors: ["FORBIDDEN", "NOT_FOUND", "VALIDATION_ERROR"],
  },
  async ({ params: p, body, user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    await requireOwner(user, p.id);
    return { data: await addStaff(p.id, user.id, body.user_id, body.location_id) };
  },
);

export const GET = listRoute.handler;
export const POST = createRoute.handler;
