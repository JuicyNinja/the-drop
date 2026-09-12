import { z } from "@/lib/zod";
import { defineRoute } from "@/lib/api/route";
import { getEnv } from "@/lib/env";
import pkg from "@/package.json";

/**
 * API-CONTRACT §1.7: liveness.
 *
 * Answers "is the app running." No dependency pings, by design: a Redis
 * hiccup must not mark the platform down while every catch is still
 * succeeding. This is what uptime monitors and Vercel hit.
 */

export const healthSchema = z
  .object({
    status: z.literal("ok"),
    env: z.enum(["local", "staging", "production"]),
    version: z.string(),
  })
  .openapi("Health");

const route = defineRoute({
  method: "get",
  path: "/v1/health",
  operationId: "getHealth",
  summary: "Liveness",
  description:
    "Is the app running. No dependency pings. Exempt from X-Client headers so monitors can call it.",
  tags: ["Operations"],
  auth: "none",
  clientHeaders: false,
  response: { data: healthSchema },
}, async () => ({
  data: { status: "ok", env: getEnv().APP_ENV, version: pkg.version },
}));

export const GET = route.handler;
