import path from "node:path";
import type { NextConfig } from "next";

const localApiOrigin = (process.env.KEYSERVICE_PUBLIC_URL || "http://127.0.0.1:3021").replace(
  /\/+$/,
  "",
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // The 1 GB origin cannot afford sharp on every logo request.
  images: { unoptimized: true },
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
        headers: [{ key: "Cache-Control", value: "public, max-age=30, s-maxage=120" }],
      },
      {
        source: "/login",
        headers: [{ key: "Cache-Control", value: "public, max-age=30, s-maxage=120" }],
      },
    ];
  },
};

export default nextConfig;
