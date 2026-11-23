import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Static security headers. The Content-Security-Policy is per-request (nonce) and
// is set in src/middleware.ts.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  // Lets an isolated test server (own DB + port) run next to the dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@node-rs/argon2"],
  experimental: {
    // Room for one broadcast attachment (max 10 MB) plus the form
    serverActions: { bodySizeLimit: "12mb" },
    middlewareClientMaxBodySize: "12mb",
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Exam Prep's marking screen frames the answer-sheet PDF from its own origin; everything else is never framed
      { source: "/((?!exam-prep).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
      { source: "/exam-prep/:path*", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
      // Chaos Creators' facts recording deck records the reader with the microphone (this site only; camera etc. stay off)
      { source: "/chaos/:path*", headers: [{ key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()" }] },
    ];
  },
};

export default nextConfig;
