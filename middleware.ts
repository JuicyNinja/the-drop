import { NextResponse, type NextRequest } from "next/server";

/**
 * Security headers on every response, with a strict, nonce-based CSP.
 *
 * The web client holds the refresh token in browser storage, so the XSS
 * surface is closed by other means (API-CONTRACT §2): a CSP with no
 * unsafe-inline and no unsafe-eval, a per-request nonce for scripts, and
 * dangerouslySetInnerHTML lint-banned. connect-src allows the Supabase origin
 * (REST, Auth, and realtime WebSocket) and nothing else.
 */
export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseWs = supabaseUrl.replace(/^http/, "ws");
  const connectSrc = ["'self'", supabaseUrl, supabaseWs].filter(Boolean).join(" ");

  const csp = [
    `default-src 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `img-src 'self' data: https:`,
    `font-src 'self'`,
    `style-src 'self' 'nonce-${nonce}'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `connect-src ${connectSrc}`,
  ].join("; ");

  // Pass the nonce to the app so Next tags its own scripts with it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set(
    "strict-transport-security",
    "max-age=63072000; includeSubDomains",
  );
  return response;
}

export const config = {
  // Everything except Next's static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
