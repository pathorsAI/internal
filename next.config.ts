import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production/OpenNext builds use a separate dist dir (NEXT_DIST_DIR=.next-prod)
  // so they never clobber the `.next` that `next dev` is actively using.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

// Enables Cloudflare bindings (env, KV, etc.) during `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
