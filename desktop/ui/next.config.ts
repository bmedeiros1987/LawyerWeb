import path from "node:path";
import type { NextConfig } from "next";

// Static export only: the desktop UI has no server functions. All data access
// goes through Tauri commands executed by the local app process.
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  // Builds run from desktop/ (npm scripts), where node_modules lives.
  turbopack: { root: path.resolve(process.cwd()) },
};

export default nextConfig;
