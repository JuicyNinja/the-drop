import { z } from "@/lib/zod";
import { BEARER_AUTH, registry } from "@/lib/api/registry";
import { errorEnvelopeSchema, isApiError, ApiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { requireLocationAccess } from "@/lib/auth/org-access";
import { renderCodeSheet } from "@/lib/pdf";

/**
 * API-CONTRACT §10: the printable code sheet PDF. Binary response, so this
 * route is registered in the OpenAPI spec by hand and returns raw bytes rather
 * than going through defineRoute's JSON envelope. Owner / admin / staff of the
 * location. X-Client headers are not required (a browser fetching a PDF).
 */
registry.registerPath({
  method: "get",
  path: "/v1/locations/{id}/code-sheet.pdf",
  operationId: "getLocationCodeSheet",
  summary: "Printable code sheet (PDF)",
  tags: ["Merchant"],
  security: [{ [BEARER_AUTH]: [] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "The code sheet PDF.", content: { "application/pdf": { schema: z.string().openapi({ format: "binary" }) } } },
    401: { description: "Error. code: UNAUTHENTICATED", content: { "application/json": { schema: errorEnvelopeSchema } } },
    403: { description: "Error. code: FORBIDDEN", content: { "application/json": { schema: errorEnvelopeSchema } } },
    404: { description: "Error. code: NOT_FOUND", content: { "application/json": { schema: errorEnvelopeSchema } } },
  },
});

function errorResponse(e: unknown): Response {
  const err = isApiError(e) ? e : new ApiError("INTERNAL_ERROR", "Unexpected server error.");
  if (!isApiError(e)) console.error("[code-sheet] unhandled", e);
  return new Response(JSON.stringify(err.toEnvelope()), {
    status: err.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<Record<string, string | string[] | undefined>> },
): Promise<Response> {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    const parsed = z.uuid().safeParse(id);
    if (!parsed.success) throw new ApiError("NOT_FOUND", "No such location.");
    await requireLocationAccess(user, parsed.data);
    const pdf = await renderCodeSheet(parsed.data);
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="code-sheet.pdf"',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
