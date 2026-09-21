import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Сайт лежит внутри репозитория приложения: без явного корня Turbopack
  // находит package-lock.json приложения уровнем выше и берёт его за корень.
  turbopack: { root: path.join(__dirname) },
  images: { formats: ["image/avif", "image/webp"] },
  poweredByHeader: false,
};

export default nextConfig;
