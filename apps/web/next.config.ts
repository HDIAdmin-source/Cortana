import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // packages/shared is plain TypeScript source; let Next compile it.
  transpilePackages: ["@cortana/shared"],
};

export default nextConfig;
