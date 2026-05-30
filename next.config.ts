import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static and fluent-ffmpeg ship native binaries / dynamic require()s
  // that Next.js will mangle if it tries to bundle them. Keep them external.
  serverExternalPackages: ["ffmpeg-static", "fluent-ffmpeg"],
};

export default nextConfig;
