import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/route";
import { EnvError, getEnv } from "@/lib/env";
import { pingRedis } from "@/lib/redis";
import { pingSupabase } from "@/lib/supabase/server";

/**
 * API-CONTRACT §1.7: readiness.
 *
 * Answers "is the app wired." Pings Supabase and Redis. 200 when both
 * respond, 503 NOT_READY with the standard envelope when either does not.
 * Not for monitors: used by engineers and CI to confirm an environment.
 */

export const readySchema = z
  .object({
    status: z.literal("ready"),
    checks: z.object({
      supabase: z.literal("ok"),
      redis: z.literal("ok"),
    }),
  })
  .openapi("Ready");

function describe(result: PromiseSettledResult<void>): string {
  if (result.status === "fulfilled") return "ok";
  const reason: unknown = result.reason;
  return `failed: ${reason instanceof Error ? reason.message : String(reason)}`;
}

const route = defineRoute(
  {
    method: "get",
    path: "/v1/ready",
    operationId: "getReady",
    summary: "Readiness",
    description:
      "Is the app wired. Pings Supabase and Redis. 503 NOT_READY names each dependency's result in details.checks.",
    tags: ["Operations"],
    auth: "none",
    clientHeaders: false,
    response: { data: readySchema },
    errors: ["NOT_READY"],
  },
  async () => {
    try {
      getEnv();
    } catch (error) {
      throw new ApiError("NOT_READY", "Environment is not configured.", {
        env: error instanceof EnvError ? error.problems : String(error),
      });
    }

    const [supabase, redis] = await Promise.allSettled([
      pingSupabase(),
      pingRedis(),
    ]);
    const checks = { supabase: describe(supabase), redis: describe(redis) };

    if (checks.supabase !== "ok" || checks.redis !== "ok") {
      throw new ApiError("NOT_READY", "A dependency did not respond.", {
        checks,
      });
    }

    return {
      data: { status: "ready", checks: { supabase: "ok", redis: "ok" } },
    };
  },
);

export const GET = route.handler;
