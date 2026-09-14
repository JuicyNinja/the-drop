import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { isAdmin } from "@/lib/auth/org-access";
import { runTransferSweep } from "@/lib/transfers";

/**
 * The server-side transfer sweeper (API-CONTRACT §7), exposed for the external
 * ticker and for testing. In production an Upstash/QStash schedule calls this
 * every ~30 seconds. It is what replaces client-side timers: expiry and voiding
 * happen here regardless of whether any client is online. Admin only.
 *
 * Runs with the server's real clock and is safe under concurrent invocation —
 * two overlapping sweeps never double-resolve a transfer (each transition is a
 * conditional UPDATE ... WHERE status='pending').
 */
const route = defineRoute(
  {
    method: "post",
    path: "/v1/admin/transfers/sweep",
    operationId: "adminTransferSweep",
    summary: "Run one transfer sweeper pass",
    tags: ["Admin"],
    auth: "user",
    response: {
      data: z.object({
        voided: z.array(z.string()),
        expired: z.array(z.string()),
      }),
    },
    errors: ["FORBIDDEN"],
  },
  async ({ user }) => {
    if (!user) throw new ApiError("UNAUTHENTICATED", "No authenticated user.");
    if (!(await isAdmin(user))) throw new ApiError("FORBIDDEN", "Admin only.");
    return { data: await runTransferSweep() };
  },
);

export const POST = route.handler;
