import { z } from "@/lib/zod";
import { BEARER_AUTH, claimRoute, registry } from "@/lib/api/registry";
import {
  ApiError,
  ERROR_CODES,
  errorEnvelopeSchema,
  isApiError,
  type ErrorCode,
} from "@/lib/api/errors";
import { requireUser, verifySession } from "@/lib/auth/session";
import type { UserRecord } from "@/lib/users";

/**
 * `defineRoute` is the only way a `/v1` endpoint comes into existence.
 *
 * One call does three things that must never drift apart:
 *   1. registers the route in the OpenAPI registry (the native contract),
 *   2. validates the request against the same Zod schemas the spec is
 *      generated from,
 *   3. validates the response before it leaves the server.
 *
 * A route file under app/api/v1 exports the returned `handler` as GET, POST,
 * etc. Nothing else. Business logic lives in the handler you pass in.
 *
 * The route is generic over the response *data type* (`z.ZodType<TData>`),
 * not over the schema type. Generic-over-schema plus `z.input<T>` makes
 * TypeScript widen every literal in the handler's return ("ok" becomes
 * string); generic-over-data keeps them. Do not "simplify" this back.
 */

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export const HTTP_METHOD_EXPORTS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;

/** API-CONTRACT §1.2: X-Client values. */
export const CLIENT_NAMES = ["web", "ios", "android"] as const;
export type ClientName = (typeof CLIENT_NAMES)[number];

const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** API-CONTRACT §1.2: required on every route except the operational ones. */
export const clientHeadersSchema = z.object({
  "X-Client": z.enum(CLIENT_NAMES).openapi({
    description: "Calling client. Telemetry and capability gating.",
  }),
  "X-Client-Version": z
    .string()
    .regex(SEMVER, "must be semver")
    .openapi({ description: "Client version, semver.", example: "1.0.0" }),
});

export interface ClientInfo {
  name: ClientName;
  version: string;
}

type Infer<T> = T extends z.ZodType ? z.output<T> : undefined;

export type AuthMode = "none" | "session" | "user";

export interface HandlerContext<TQuery, TBody, TParams> {
  request: Request;
  query: Infer<TQuery>;
  body: Infer<TBody>;
  params: Infer<TParams>;
  /** Parsed X-Client headers, or null on routes that exempt them. */
  client: ClientInfo | null;
  /** Auth uid on `session`/`user` routes; null on `none`. */
  authUserId: string | null;
  /** Auth email on `session`/`user` routes when the provider supplied one. */
  authEmail: string | null;
  /** The completed users row on `user` routes; null otherwise. */
  user: UserRecord | null;
}

export interface HandlerResult<TData> {
  data: TData;
  meta?: Record<string, unknown>;
}

export interface RouteConfig<
  TQuery extends z.ZodObject | undefined,
  TBody extends z.ZodType | undefined,
  TParams extends z.ZodObject | undefined,
  TData,
> {
  method: HttpMethod;
  /** Contract path, e.g. `/v1/drops/{id}`. Must match the file location. */
  path: `/v1${string}`;
  operationId: string;
  summary: string;
  description?: string;
  tags: [string, ...string[]];
  /**
   * `none`: public. `session`: a valid Supabase JWT, users row optional (the
   * registration completion routes). `user`: a valid JWT AND a completed,
   * non-suspended users row. All three verified server-side before the
   * handler runs.
   */
  auth: AuthMode;
  /**
   * Whether X-Client and X-Client-Version are required (API-CONTRACT §1.2).
   * Defaults to true. Only the operational routes in §1.7 opt out.
   */
  clientHeaders?: boolean;
  request?: {
    query?: TQuery;
    body?: TBody;
    params?: TParams;
  };
  response: {
    /** Success status. Defaults to 200. */
    status?: 200 | 201;
    /** Schema for the `data` member of the success envelope. */
    data: z.ZodType<TData>;
  };
  /** Error codes this route can return, beyond the ones every route shares. */
  errors?: ErrorCode[];
}

export type Handler<TQuery, TBody, TParams, TData> = (
  ctx: HandlerContext<TQuery, TBody, TParams>,
) => Promise<HandlerResult<TData>>;

/** What a Next.js route file exports as GET, POST, ... */
export type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;

export interface DefinedRoute {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
}

const errorEnvelopeComponent = errorEnvelopeSchema.openapi("ErrorEnvelope");

function successEnvelope(data: z.ZodType, name: string) {
  return z
    .object({
      data,
      meta: z.record(z.string(), z.unknown()),
    })
    .openapi(name);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function errorResponse(error: unknown): Response {
  if (isApiError(error)) {
    return json(error.toEnvelope(), error.status);
  }
  console.error("[api] unhandled error", error);
  const internal = new ApiError("INTERNAL_ERROR", "Unexpected server error.");
  return json(internal.toEnvelope(), internal.status);
}

function parseWith<T extends z.ZodType>(
  schema: T,
  input: unknown,
  where: "headers" | "params" | "query" | "body",
): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ApiError("VALIDATION_ERROR", `Invalid ${where}.`, {
    [where]: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  });
}

function parseClientHeaders(request: Request): ClientInfo {
  const parsed = parseWith(
    clientHeadersSchema,
    {
      "X-Client": request.headers.get("x-client") ?? undefined,
      "X-Client-Version": request.headers.get("x-client-version") ?? undefined,
    },
    "headers",
  );
  return { name: parsed["X-Client"], version: parsed["X-Client-Version"] };
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Body must be valid JSON.", {
      body: [{ path: "", message: "invalid JSON" }],
    });
  }
}

function errorResponses(codes: ErrorCode[]) {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const status = ERROR_CODES[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  const responses: Record<
    number,
    { description: string; content: Record<string, { schema: z.ZodType }> }
  > = {};
  for (const [status, list] of [...byStatus.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    responses[status] = {
      description: `Error. code: ${[...new Set(list)].sort().join(" | ")}`,
      content: { "application/json": { schema: errorEnvelopeComponent } },
    };
  }
  return responses;
}

export function defineRoute<
  TQuery extends z.ZodObject | undefined = undefined,
  TBody extends z.ZodType | undefined = undefined,
  TParams extends z.ZodObject | undefined = undefined,
  TData = unknown,
>(
  config: RouteConfig<TQuery, TBody, TParams, TData>,
  handle: Handler<TQuery, TBody, TParams, TData>,
): DefinedRoute {
  const requireClientHeaders = config.clientHeaders !== false;
  const successStatus = config.response.status ?? 200;
  const hasRequestSchema =
    requireClientHeaders ||
    config.request?.query !== undefined ||
    config.request?.body !== undefined ||
    config.request?.params !== undefined;

  const shouldRegister = claimRoute(config.method, config.path);

  const sharedErrors: ErrorCode[] = ["INTERNAL_ERROR"];
  if (hasRequestSchema) sharedErrors.push("VALIDATION_ERROR");
  if (config.auth !== "none") sharedErrors.push("UNAUTHENTICATED");
  if (config.auth === "user") sharedErrors.push("ACCOUNT_SUSPENDED");

  if (shouldRegister) registry.registerPath({
    method: config.method,
    path: config.path,
    operationId: config.operationId,
    summary: config.summary,
    description: config.description,
    tags: config.tags,
    security: config.auth === "none" ? [] : [{ [BEARER_AUTH]: [] }],
    request: {
      headers: requireClientHeaders ? clientHeadersSchema : undefined,
      params: config.request?.params,
      query: config.request?.query,
      body: config.request?.body
        ? {
            required: true,
            content: {
              "application/json": { schema: config.request.body },
            },
          }
        : undefined,
    },
    responses: {
      [successStatus]: {
        description: "Success",
        content: {
          "application/json": {
            schema: successEnvelope(
              config.response.data,
              `${config.operationId}Response`,
            ),
          },
        },
      },
      ...errorResponses([...sharedErrors, ...(config.errors ?? [])]),
    },
  });

  const handler: RouteHandler = async (request, context) => {
    try {
      const client = requireClientHeaders ? parseClientHeaders(request) : null;

      let authUserId: string | null = null;
      let authEmail: string | null = null;
      let user: UserRecord | null = null;
      if (config.auth === "user") {
        user = await requireUser(request);
        authUserId = user.id;
        authEmail = user.email;
      } else if (config.auth === "session") {
        const identity = await verifySession(request);
        authUserId = identity.authUserId;
        authEmail = identity.email;
      }

      const params = (
        config.request?.params
          ? parseWith(config.request.params, await context.params, "params")
          : undefined
      ) as Infer<TParams>;

      const query = (
        config.request?.query
          ? parseWith(
              config.request.query,
              Object.fromEntries(new URL(request.url).searchParams),
              "query",
            )
          : undefined
      ) as Infer<TQuery>;

      const body = (
        config.request?.body
          ? parseWith(config.request.body, await readJsonBody(request), "body")
          : undefined
      ) as Infer<TBody>;

      const result = await handle({
        request,
        query,
        body,
        params,
        client,
        authUserId,
        authEmail,
        user,
      });

      const validated = config.response.data.safeParse(result.data);
      if (!validated.success) {
        console.error(
          `[api] ${config.operationId} response failed contract validation`,
          validated.error.issues,
        );
        throw new ApiError("INTERNAL_ERROR", "Unexpected server error.");
      }

      return json({ data: validated.data, meta: result.meta ?? {} }, successStatus);
    } catch (error) {
      return errorResponse(error);
    }
  };

  return { method: config.method, path: config.path, handler };
}
