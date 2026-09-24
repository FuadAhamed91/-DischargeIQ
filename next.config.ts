import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-only "N" badge defaults to bottom-left, on top of the sidebar's Settings link.
  devIndicators: { position: 'bottom-right' },
  experimental: {
    // Vercel restores .next/cache between builds. With Turbopack's persistent
    // build cache on, a large globals.css change shipped with the *previous*
    // stylesheet (stale chunk reused). The app builds in well under a minute
    // without it, so trade the cache for deterministic output.
    turbopackFileSystemCacheForBuild: false,
    // Client router cache. Every dashboard page is dynamic (auth), so without
    // this each sidebar hop re-renders on the server. Revisits inside 30s come
    // straight from memory; mutations call router.refresh() which bypasses it,
    // and alerts stay live through their realtime subscriptions regardless.
    // `static` also caps how long an intent-prefetched page (NavLink) is kept.
    staleTimes: { dynamic: 30, static: 60 },
  },
};

export default nextConfig;
