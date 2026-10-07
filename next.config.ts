import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pdfjs loads its worker file next to itself at runtime: keep it as a Node package (not bundled).
  serverExternalPackages: ["pdfjs-dist"],
  // Desktop builds (desktop/scripts/build-server.mjs) package a self-contained
  // production server; the web/Render build is unchanged.
  ...(process.env.MBLZ_DESKTOP_BUILD === "1" ? {
    output: "standalone" as const,
    // Desktop file operations act on user-chosen absolute paths at runtime, never on project files.
    outputFileTracingExcludes: { "*": ["./desktop/**/*", "./docs/**/*", "./tests/**/*", "./scripts/**/*", "./.github/**/*", "./*.md"] },
  } : {}),
  experimental: {
    // Render build hosts can expose many CPUs; bound Next's page-data worker pool.
    cpus: 4,
    staticGenerationMaxConcurrency: 4,
    staticGenerationMinPagesPerWorker: 8,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
