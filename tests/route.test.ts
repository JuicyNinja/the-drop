import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "@/lib/zod";
import { ApiError } from "@/lib/api/errors";
import { registry } from "@/lib/api/registry";
import { defineRoute } from "@/lib/api/route";

const CLIENT = { "x-client": "ios", "x-client-version": "1.2.3" };
const CTX = { params: Promise.resolve({}) };

function post(path: string, body: unknown, headers: Record<string, string> = CLIENT) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("defineRoute", () => {
  const echo = defineRoute({
    method: "post",
    path: "/v1/test/echo",
    operationId: "testEcho",
    summary: "Echo",
    tags: ["Test"],
    auth: "none",
    request: {
      body: z.object({ name: z.string().min(1) }),
      query: z.object({ shout: z.enum(["yes", "no"]).optional() }),
    },
    response: { data: z.object({ greeting: z.string(), client: z.string() }) },
    errors: ["NOT_FOUND"],
  }, async ({ body, query, client }) => {
      if (body.name === "missing") throw new ApiError("NOT_FOUND", "No one here.");
      if (body.name === "boom") throw new Error("kaboom");
      if (body.name === "bad-shape") {
        return { data: { greeting: 42 } as unknown as { greeting: string; client: string } };
      }
      const greeting = `hi ${body.name}`;
      return {
        data: {
          greeting: query.shout === "yes" ? greeting.toUpperCase() : greeting,
          client: `${client?.name}@${client?.version}`,
        },
        meta: { echoed: true },
      };
  });

  const exempt = defineRoute({
    method: "get",
    path: "/v1/test/exempt",
    operationId: "testExempt",
    summary: "No client headers",
    tags: ["Test"],
    auth: "none",
    clientHeaders: false,
    response: { data: z.object({ ok: z.literal(true) }) },
  }, async ({ client }) => ({ data: { ok: true }, meta: { client } }));

  beforeAll(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns the success envelope { data, meta }", async () => {
    const res = await echo.handler(post("/v1/test/echo?shout=yes", { name: "ana" }), CTX);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      data: { greeting: "HI ANA", client: "ios@1.2.3" },
      meta: { echoed: true },
    });
  });

  it("meta is always present, defaulting to {}", async () => {
    const res = await exempt.handler(new Request("http://localhost/v1/test/exempt"), CTX);
    expect(await res.json()).toEqual({ data: { ok: true }, meta: { client: null } });
  });

  it("rejects a missing X-Client header with 422 VALIDATION_ERROR", async () => {
    const res = await echo.handler(post("/v1/test/echo", { name: "ana" }, {}), CTX);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.headers.map((h: { path: string }) => h.path)).toEqual([
      "X-Client",
      "X-Client-Version",
    ]);
  });

  it("rejects an unknown X-Client and a non-semver X-Client-Version", async () => {
    const res = await echo.handler(
      post("/v1/test/echo", { name: "ana" }, { "x-client": "desktop", "x-client-version": "v1" }),
      CTX,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.details.headers).toHaveLength(2);
  });

  it("validates the body against the schema", async () => {
    const res = await echo.handler(post("/v1/test/echo", { name: "" }), CTX);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "VALIDATION_ERROR", message: "Invalid body." });
    expect(body.error.details.body[0].path).toBe("name");
  });

  it("rejects malformed JSON with 422", async () => {
    const res = await echo.handler(post("/v1/test/echo", "{not json"), CTX);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("Body must be valid JSON.");
  });

  it("validates the query string", async () => {
    const res = await echo.handler(post("/v1/test/echo?shout=loud", { name: "ana" }), CTX);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("Invalid query.");
  });

  it("maps a thrown ApiError to its contract status and envelope", async () => {
    const res = await echo.handler(post("/v1/test/echo", { name: "missing" }), CTX);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "No one here.", details: {} },
    });
  });

  it("maps an unexpected throw to 500 INTERNAL_ERROR without leaking internals", async () => {
    const res = await echo.handler(post("/v1/test/echo", { name: "boom" }), CTX);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error.", details: {} },
    });
    expect(JSON.stringify(body)).not.toContain("kaboom");
  });

  it("validates the response and fails closed on a contract violation", async () => {
    const res = await echo.handler(post("/v1/test/echo", { name: "bad-shape" }), CTX);
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
  });

  it("registers the route in the OpenAPI registry with headers, body, and errors", () => {
    const def = registry.definitions.find(
      (d) => d.type === "route" && d.route.path === "/v1/test/echo",
    );
    expect(def).toBeDefined();
    if (def?.type !== "route") throw new Error("unreachable");
    expect(def.route.method).toBe("post");
    expect(def.route.request?.headers).toBeDefined();
    expect(def.route.request?.body).toBeDefined();
    expect(Object.keys(def.route.responses).sort()).toEqual(["200", "404", "422", "500"]);
  });

  it("exempt routes register without the client header requirement", () => {
    const def = registry.definitions.find(
      (d) => d.type === "route" && d.route.path === "/v1/test/exempt",
    );
    if (def?.type !== "route") throw new Error("unreachable");
    expect(def.route.request?.headers).toBeUndefined();
    expect(Object.keys(def.route.responses).sort()).toEqual(["200", "500"]);
  });

  it("refuses a second definition of the same method and path", () => {
    expect(() =>
      defineRoute({
        method: "get",
        path: "/v1/test/exempt",
        operationId: "dup",
        summary: "dup",
        tags: ["Test"],
        auth: "none",
        response: { data: z.object({}) },
      }, async () => ({ data: {} })),
    ).toThrow("Route already defined: GET /v1/test/exempt");
  });
});
