import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@hedged/shared", "@hedged/arc"],
  // The dev-only "N" badge sits on top of the phone tab bar.
  devIndicators: false,
};

export default nextConfig;
