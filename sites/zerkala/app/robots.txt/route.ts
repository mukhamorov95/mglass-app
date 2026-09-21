import { SITE, abs } from "@/lib/site";

export const dynamic = "force-static";

// Свой robots.txt вместо robots.ts: Clean-param Яндекса убирает дубли страниц
// с utm-метками, а в MetadataRoute.Robots этой директивы нет.
export function GET() {
  const body = SITE.indexable
    ? [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "",
        "User-agent: Yandex",
        "Allow: /",
        "Disallow: /api/",
        "Clean-param: utm_source&utm_medium&utm_campaign&utm_term&utm_content&yclid&gclid",
        "",
        `Sitemap: ${abs("/sitemap.xml")}`,
      ]
    : ["# Сайт ещё не открыт для индексации (SITE_INDEXABLE)", "User-agent: *", "Disallow: /"];
  return new Response(body.join("\n") + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
