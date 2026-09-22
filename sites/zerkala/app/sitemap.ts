import type { MetadataRoute } from "next";
import { LANDINGS } from "@/content/landings";
import { QUESTIONS } from "@/content/questions";
import { SITE, abs } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(SITE.contentUpdated);
  return [
    { url: abs("/"), lastModified, changeFrequency: "weekly", priority: 1 },
    ...LANDINGS.map((l) => ({ url: abs(`/${l.slug}`), lastModified, changeFrequency: "monthly" as const, priority: 0.8 })),
    { url: abs("/vopros"), lastModified, changeFrequency: "monthly", priority: 0.7 },
    ...QUESTIONS.map((q) => ({ url: abs(`/vopros/${q.slug}`), lastModified, changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: abs("/otzyvy"), lastModified, changeFrequency: "weekly", priority: 0.7 },
    { url: abs("/raboty"), lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: abs("/kontakty"), lastModified, changeFrequency: "yearly", priority: 0.5 },
  ];
}
