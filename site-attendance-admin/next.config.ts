import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // deploy/update-admin.sh builds into a separate directory (NEXT_DIST_DIR) and swaps
  // it in when the build is complete, so the running site keeps serving its files
  // during the build. `next dev` and `next start` use the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // In production nginx compresses responses (deploy/nginx/buildtruck-admin.conf).
  compress: false,
  // No "X-Powered-By: Next.js" header.
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
