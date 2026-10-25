import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let the hosted preview + Vercel deployments reach the dev server.
  allowedDevOrigins: [
    "*.e2b.app",
    "*.vercel.app",
    "localhost:3000",
    "127.0.0.1:3000",
  ],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
