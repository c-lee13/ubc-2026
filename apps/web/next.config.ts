import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@hedged/shared", "@hedged/arc"],
};

export default nextConfig;
