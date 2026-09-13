import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPENAPI_FILE,
  contractPathFor,
  generateOpenApiDocument,
  serializeOpenApi,
} from "@/lib/api/openapi";

const ROOT = path.resolve(__dirname, "..");

describe("openapi.json (the native contract)", () => {
  it("maps route file locations to contract paths", () => {
    expect(contractPathFor(path.join("app", "api", "v1", "health", "route.ts"))).toBe(
      "/v1/health",
    );
    expect(
      contractPathFor(path.join("app", "api", "v1", "drops", "[id]", "route.ts")),
    ).toBe("/v1/drops/{id}");
    expect(
      contractPathFor(path.join("app", "api", "v1", "orgs", "[id]", "locations", "route.ts")),
    ).toBe("/v1/orgs/{id}/locations");
  });

  it("is generated from every route file under app/api/v1", async () => {
    const doc = await generateOpenApiDocument(ROOT);
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths ?? {})).toEqual([
      "/v1/addresses",
      "/v1/addresses/{id}",
      "/v1/auth/oauth/callback",
      "/v1/auth/oauth/start",
      "/v1/auth/phone/verify/confirm",
      "/v1/auth/phone/verify/send",
      "/v1/auth/refresh",
      "/v1/auth/register/complete",
      "/v1/catches",
      "/v1/health",
      "/v1/ready",
      "/v1/users/me",
      "/v1/users/me/active-address",
      "/v1/users/me/handle-search",
      "/v1/users/me/location-drift",
      "/v1/users/me/location-permission",
      "/v1/users/me/walkthrough/complete",
      "/v1/users/me/walkthrough/skip",
    ]);
  });

  it("registers authenticated routes with bearer security and 401", async () => {
    const doc = await generateOpenApiDocument(ROOT);
    const me = (doc.paths?.["/v1/users/me"] as { get: { security: unknown[]; responses: Record<string, unknown> } }).get;
    expect(me.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(me.responses)).toContain("401");
    const catches = (doc.paths?.["/v1/catches"] as { post: { responses: Record<string, unknown> } }).post;
    expect(Object.keys(catches.responses)).toContain("501");
  });

  it("documents both operational routes as header-exempt and unauthenticated", async () => {
    const doc = await generateOpenApiDocument(ROOT);
    for (const p of ["/v1/health", "/v1/ready"]) {
      const op = (doc.paths?.[p] as { get: Record<string, unknown> }).get;
      expect(op.security).toEqual([]);
      expect(op.parameters ?? []).toEqual([]);
    }
    const ready = (doc.paths?.["/v1/ready"] as { get: { responses: Record<string, unknown> } }).get;
    expect(Object.keys(ready.responses).sort()).toEqual(["200", "500", "503"]);
  });

  it("matches the committed openapi.json (drift check)", async () => {
    const committed = fs
      .readFileSync(path.join(ROOT, OPENAPI_FILE), "utf8")
      .replace(/\r\n/g, "\n");
    const generated = serializeOpenApi(await generateOpenApiDocument(ROOT));
    expect(committed).toBe(generated);
  });

  it("generation is deterministic", async () => {
    const a = serializeOpenApi(await generateOpenApiDocument(ROOT));
    const b = serializeOpenApi(await generateOpenApiDocument(ROOT));
    expect(a).toBe(b);
  });
});
