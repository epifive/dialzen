import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The browser test call and the agent preview use the microphone of this site only.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Lets a second development server run from the same folder (NEXT_DIST_DIR=.next-test).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Native / server-only packages that must not be bundled.
  serverExternalPackages: ["mysql2", "nodemailer"],
  experimental: {
    serverActions: {
      // Logo / favicon uploads from the admin panel.
      bodySizeLimit: "5mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    // Every page may only be framed by this site.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
