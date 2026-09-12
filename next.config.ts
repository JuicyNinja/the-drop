import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * API-CONTRACT base path is `/v1`. Route handlers live under `app/api/v1/*`
   * (BUILD-PLAN WP-1). This rewrite makes the contract path canonical for
   * every client, web or native.
   */
  async rewrites() {
    return [{ source: "/v1/:path*", destination: "/api/v1/:path*" }];
  },
};

export default nextConfig;
