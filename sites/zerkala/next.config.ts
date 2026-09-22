import path from "node:path";
import type { NextConfig } from "next";

// STATIC_EXPORT=1 — сборка готовыми файлами для российского хостинга (npm run build:static).
// Прямые соединения из России к Vercel замирают после ~16 КБ (фильтр на стороне провайдеров),
// поэтому боевой сайт лежит на российском IP. Оптимизатора картинок там нет: варианты
// по ширинам нарезает scripts/export-images.mjs, а lib/exportImageLoader.ts на них ссылается.
const isExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  // Сайт лежит внутри репозитория приложения: без явного корня Turbopack
  // находит package-lock.json приложения уровнем выше и берёт его за корень.
  turbopack: { root: path.join(__dirname) },
  poweredByHeader: false,
  ...(isExport
    ? {
        output: "export" as const,
        images: {
          loader: "custom" as const,
          loaderFile: "./lib/exportImageLoader.ts",
          deviceSizes: [480, 768, 1080, 1200],
          imageSizes: [256, 384],
        },
      }
    : { images: { formats: ["image/avif" as const, "image/webp" as const] } }),
};

export default nextConfig;
