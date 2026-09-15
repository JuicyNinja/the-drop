import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * API-CONTRACT base path is `/v1`. Route handlers live under `app/api/v1/*`
   * (BUILD-PLAN WP-1). This rewrite makes the contract path canonical for
   * every client, web or native.
   */
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: "/api/v1/:path*" },
      // Public share short link (API-CONTRACT §9 `GET /s/{token}`). The handler
      // lives under /v1 (every route handler must — invariant #15); this keeps
      // the short, shareable public URL.
      { source: "/s/:token", destination: "/api/v1/shares/:token/click" },
    ];
  },
};

export default nextConfig;
