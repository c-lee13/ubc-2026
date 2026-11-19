import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@hedged/shared", "@hedged/arc"],
  // The dev-only "N" badge sits on top of the phone tab bar.
  devIndicators: false,
  // Phone previews over wifi (e.g. NEXT_ALLOWED_DEV_ORIGINS=10.48.89.45): dev only, no effect on builds.
  allowedDevOrigins: (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "").split(",").filter(Boolean),
};

export default nextConfig;
