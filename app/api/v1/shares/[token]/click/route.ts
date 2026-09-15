import { z } from "@/lib/zod";
import { registry } from "@/lib/api/registry";
import { recordClick } from "@/lib/shares";
import { getEnv } from "@/lib/env";

/**
 * API-CONTRACT §9 `GET /s/{token}`: the public share-link redirect. Exposed at
 * the short public URL `/s/{token}` via a rewrite in next.config; the handler
 * lives here under /v1 because every route handler must (invariant #15). It is a
 * browser redirect, not a JSON API call, so it is registered by hand (like the
 * code-sheet PDF) rather than through defineRoute, and returns a 302.
 *
 * A raw click is analytics ONLY — it grants no clout. A bot, a scraper, or the
 * sharer could produce it. Clout is earned solely on a verified return
 * (POST /v1/shares/{token}/verify).
 */
registry.registerPath({
  method: "get",
  path: "/v1/shares/{token}/click",
  operationId: "shareClickRedirect",
  summary: "Public share-link redirect (/s/{token})",
  tags: ["Clout"],
  security: [],
  request: { params: z.object({ token: z.string() }) },
  responses: {
    302: { description: "Redirect to the shared drop (or home if the token is unknown)." },
  },
});

export async function GET(
  _request: Request,
  context: { params: Promise<Record<string, string | string[] | undefined>> },
): Promise<Response> {
  const appUrl = getEnv().APP_URL.replace(/\/$/, "");
  try {
    const { token } = await context.params;
    const t = typeof token === "string" ? token : "";
    const hit = t ? await recordClick(t) : null;
    const location = hit ? `${appUrl}/drops/${hit.drop_id}?ref=${encodeURIComponent(t)}` : appUrl;
    return new Response(null, { status: 302, headers: { location } });
  } catch (e) {
    console.error("[/s] redirect failed", e instanceof Error ? e.message : e);
    return new Response(null, { status: 302, headers: { location: appUrl } });
  }
}
