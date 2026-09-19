import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Vercel restores .next/cache between builds. With Turbopack's persistent
    // build cache on, a large globals.css change shipped with the *previous*
    // stylesheet (stale chunk reused). The app builds in well under a minute
    // without it, so trade the cache for deterministic output.
    turbopackFileSystemCacheForBuild: false,
  },
};

export default nextConfig;
