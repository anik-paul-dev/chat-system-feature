import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output produces a minimal, self-contained build for the
  // Docker image (only the files actually needed to run in production),
  // instead of shipping the full node_modules tree.
  output: "standalone",
};

export default nextConfig;
