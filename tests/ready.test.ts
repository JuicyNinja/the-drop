import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubValidEnv } from "./helpers/env";

vi.mock("@/lib/redis", () => ({ pingRedis: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ pingSupabase: vi.fn() }));

import { pingRedis } from "@/lib/redis";
import { pingSupabase } from "@/lib/supabase/server";
import { GET } from "@/app/api/v1/ready/route";
import { resetEnvCache } from "@/lib/env";

const CTX = { params: Promise.resolve({}) };
const request = () => new Request("http://localhost/v1/ready");

describe("GET /v1/ready (API-CONTRACT §1.7, readiness)", () => {
  beforeEach(() => stubValidEnv());

  it("returns 200 when Supabase and Redis both respond", async () => {
    vi.mocked(pingSupabase).mockResolvedValue();
    vi.mocked(pingRedis).mockResolvedValue();

    const res = await GET(request(), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { status: "ready", checks: { supabase: "ok", redis: "ok" } },
      meta: {},
    });
  });

  it("returns 503 NOT_READY naming the dependency that failed", async () => {
    vi.mocked(pingSupabase).mockResolvedValue();
    vi.mocked(pingRedis).mockRejectedValue(new Error("Redis PING returned undefined"));

    const res = await GET(request(), CTX);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: {
        code: "NOT_READY",
        message: "A dependency did not respond.",
        details: {
          checks: { supabase: "ok", redis: "failed: Redis PING returned undefined" },
        },
      },
    });
  });

  it("checks both dependencies even when the first fails", async () => {
    vi.mocked(pingSupabase).mockRejectedValue(new Error("HTTP 401"));
    vi.mocked(pingRedis).mockRejectedValue(new Error("fetch failed"));

    const res = await GET(request(), CTX);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.details.checks).toEqual({
      supabase: "failed: HTTP 401",
      redis: "failed: fetch failed",
    });
    expect(pingSupabase).toHaveBeenCalledTimes(1);
    expect(pingRedis).toHaveBeenCalledTimes(1);
  });

  it("returns 503 NOT_READY naming missing variables when the env is unconfigured", async () => {
    vi.unstubAllEnvs();
    resetEnvCache();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const res = await GET(request(), CTX);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_READY");
    expect(body.error.message).toBe("Environment is not configured.");
    expect(body.error.details.env).toContain("SUPABASE_SERVICE_ROLE_KEY is required");
    expect(pingSupabase).not.toHaveBeenCalled();
    expect(pingRedis).not.toHaveBeenCalled();
  });
});
