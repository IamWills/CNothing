import path from "node:path";
import type { NextConfig } from "next";

const localApiOrigin = (process.env.KEYSERVICE_PUBLIC_URL || "http://127.0.0.1:3021").replace(
  /\/+$/,
  "",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  turbopack: {
    root: path.resolve(__dirname),
  },
  async rewrites() {
    return [
      {
        source: "/v4/:path*",
        destination: `${localApiOrigin}/v4/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/login",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
