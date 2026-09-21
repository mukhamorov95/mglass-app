// Факты о компании для сайта — одно место. У каждого значения источник.
// confirmed: false — владелец ещё не подтвердил именно для этого сайта.
// Открыть сайт для индексации (SITE_INDEXABLE=1) с неподтверждённым фактом
// нельзя: сборка упадёт в assertLaunchReady() со списком, что проверить.

type Fact<T> = { value: T; source: string; confirmed: boolean };

function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3100";
}

export const FACTS = {
  phone: {
    value: { display: "+7 (495) 148-65-78", href: "tel:+74951486578" },
    source: "mglass.pro, блок контактов (21.09.2026); на сайте ещё +7 (931) 109-75-35, в mglass-web +7 (925) 933-50-33",
    confirmed: false,
  },
  foundedYear: {
    value: 2019,
    source: "mglass.pro: «Наша компания работает с 2019 г»",
    confirmed: false,
  },
  projects: {
    value: "400+",
    source: "mglass.pro: «Более 400 проектов» — по всей компании, не только зеркала",
    confirmed: false,
  },
  legalName: {
    value: "ИП Мухаморов Владислав Сергеевич",
    source: "mglass-web/lib/company.ts (август 2026)",
    confirmed: false,
  },
  serviceArea: {
    value: "Москва и Московская область",
    source: "mglass.pro, объекты в Москве и МО",
    confirmed: false,
  },
} satisfies Record<string, Fact<unknown>>;

export const SITE = {
  brand: "M-Glass",
  name: "M-Glass — зеркала на заказ",
  url: siteUrl(),
  indexable: process.env.SITE_INDEXABLE === "1",
  locale: "ru_RU",
  phone: FACTS.phone.value,
  foundedYear: FACTS.foundedYear.value,
  projects: FACTS.projects.value,
  legalName: FACTS.legalName.value,
  serviceArea: FACTS.serviceArea.value,
  leadEndpoint: process.env.NEXT_PUBLIC_LEAD_ENDPOINT || "",
  metrikaId: process.env.NEXT_PUBLIC_YM_ID || "",
  yandexVerification: process.env.NEXT_PUBLIC_YANDEX_VERIFICATION || "",
  // Дата последней правки текстов — идёт в lastmod карты сайта. Меняется руками
  // вместе с текстами: «сегодня» на каждой сборке Яндекс быстро перестаёт читать.
  contentUpdated: "2026-09-21",
};

export function unconfirmedFacts(): string[] {
  return Object.entries(FACTS)
    .filter(([, f]) => !f.confirmed)
    .map(([k, f]) => `${k}: ${JSON.stringify(f.value)} (источник: ${f.source})`);
}

export function assertLaunchReady(): void {
  if (!SITE.indexable) return;
  const open = unconfirmedFacts();
  if (open.length) {
    throw new Error(
      `SITE_INDEXABLE=1, но факты не подтверждены владельцем:\n- ${open.join("\n- ")}\n` +
        "Подтвердите их в sites/zerkala/lib/site.ts (confirmed: true) или уберите SITE_INDEXABLE.",
    );
  }
  if (!/^https:\/\//.test(SITE.url) || SITE.url.includes("vercel.app")) {
    throw new Error(`SITE_INDEXABLE=1 требует боевой домен в NEXT_PUBLIC_SITE_URL, сейчас: ${SITE.url}`);
  }
}

export const abs = (path: string) => `${SITE.url}${path === "/" ? "" : path}`;
