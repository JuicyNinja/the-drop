import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/health/route";
import pkg from "@/package.json";
import { stubValidEnv } from "./helpers/env";

const CTX = { params: Promise.resolve({}) };

describe("GET /v1/health (API-CONTRACT §1.7, liveness)", () => {
  beforeEach(() => stubValidEnv({ APP_ENV: "staging" }));

  it("returns 200 with { status, env, version } and no X-Client headers", async () => {
    const res = await GET(new Request("http://localhost/v1/health"), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { status: "ok", env: "staging", version: pkg.version },
      meta: {},
    });
  });

  it("does not touch Supabase or Redis", async () => {
    // A liveness probe with dead dependencies must still be 200. Point both
    // at unroutable hosts and confirm no request is attempted.
    stubValidEnv({
      APP_ENV: "production",
      GOOGLE_GEOCODING_API_KEY: "prod-key", // required in production (dev geocoder must not ship)
      NEXT_PUBLIC_SUPABASE_URL: "http://192.0.2.1:1",
      UPSTASH_REDIS_REST_URL: "http://192.0.2.1:2",
    });
    const started = Date.now();
    const res = await GET(new Request("http://localhost/v1/health"), CTX);
    expect(res.status).toBe(200);
    expect((await res.json()).data.env).toBe("production");
    expect(Date.now() - started).toBeLessThan(500);
  });
});
