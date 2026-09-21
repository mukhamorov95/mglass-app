import type { Metadata } from "next";
import type { StaticImageData } from "next/image";
import { SITE, abs } from "./site";

// Метаданные страницы. Пока сайт не открыт для индексации, каждая страница
// отдаёт noindex — дубль на *.vercel.app не должен попасть в выдачу раньше домена.
export function pageMetadata(opts: {
  path: string;
  title: string;
  description: string;
  image?: StaticImageData;
}): Metadata {
  const url = abs(opts.path);
  return {
    title: { absolute: opts.title },
    description: opts.description,
    alternates: { canonical: url },
    robots: SITE.indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: "website",
      locale: SITE.locale,
      siteName: SITE.name,
      url,
      title: opts.title,
      description: opts.description,
      images: opts.image ? [{ url: opts.image.src, width: opts.image.width, height: opts.image.height }] : undefined,
    },
  };
}

const ORG_ID = `${SITE.url}/#organization`;

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE.brand,
    url: SITE.url,
    telephone: SITE.phone.display,
    foundingDate: String(SITE.foundedYear),
    areaServed: [
      { "@type": "City", name: "Москва" },
      { "@type": "AdministrativeArea", name: "Московская область" },
    ],
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
    inLanguage: "ru-RU",
    publisher: { "@id": ORG_ID },
  };
}

// Цены в Offer появятся в С3 — из движка расчёта, не руками.
export function serviceSchema(opts: { name: string; serviceType: string; description: string; path: string; image?: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: opts.name,
    serviceType: opts.serviceType,
    description: opts.description,
    url: abs(opts.path),
    image: opts.image ? abs(opts.image) : undefined,
    provider: { "@id": ORG_ID },
    areaServed: [
      { "@type": "City", name: "Москва" },
      { "@type": "AdministrativeArea", name: "Московская область" },
    ],
  };
}

export function faqSchema(items: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: i.a },
    })),
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: abs(item.path),
    })),
  };
}
