import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Production/OpenNext builds use a separate dist dir (NEXT_DIST_DIR=.next-prod)
  // so they never clobber the `.next` that `next dev` is actively using.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // 憑證上傳走 Server Action，預設 body 上限 1MB，手機拍的發票照常常超過
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);

// Enables Cloudflare bindings (env, KV, etc.) during `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
