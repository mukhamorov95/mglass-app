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
    source: "слова владельца 22.09.2026: «+7 (495) 148-65-78 — этот»",
    confirmed: true,
  },
  foundedYear: {
    value: 2019,
    source: "ОГРНИП 319502700094848 — ИП зарегистрирован в 2019 (lib/companyRequisites.ts); mglass.pro «работает с 2019 г»",
    confirmed: true,
  },
  projects: {
    value: "5000+",
    source: "слова владельца 21.09.2026",
    confirmed: true,
  },
  legalName: {
    value: "ИП Мухаморов Владислав Сергеевич",
    source: "реквизиты исполнителя в договорах и счетах — lib/companyRequisites.ts (EXECUTOR)",
    confirmed: true,
  },
  inn: {
    value: "668505859957",
    source: "lib/companyRequisites.ts (EXECUTOR) — из шаблонов Договор/Счёт №0157-0",
    confirmed: true,
  },
  ogrnip: {
    value: "319502700094848",
    source: "lib/companyRequisites.ts (EXECUTOR)",
    confirmed: true,
  },
  leadTime: {
    value: { regular: "от 7 рабочих дней", urgent: "от 2 рабочих дней", urgentLed: "от 3 рабочих дней" },
    source: "слова владельца 21.09.2026: производство от 7 рабочих дней, срочно от 2, срочно с LED-подсветкой от 3",
    confirmed: true,
  },
  warrantyMonths: {
    value: 18,
    source: "слова владельца 21.09.2026; warrantyMonths: 18 в lib/companyRequisites.ts",
    confirmed: true,
  },
  measure: {
    value: "Выезжаем на замер",
    source: "слова владельца 21.09.2026 «замер для зеркал делаем»; бесплатно ли — не сказано, поэтому без «бесплатно»",
    confirmed: true,
  },
  serviceArea: {
    value: "Москва и Московская область",
    source: "слова владельца 22.09.2026",
    confirmed: true,
  },
  address: {
    value: {
      street: "1-й Силикатный пер., 12Б/1",
      locality: "Мытищи",
      region: "Московская область",
      full: "Московская обл., г. Мытищи, 1-й Силикатный пер., 12Б/1",
      mapsUrl: "https://yandex.ru/maps/org/mglass_ru/160929264216/",
    },
    source: "карточка «MGlass.ru» на Яндекс Картах (org 160929264216) + слова владельца 22.09.2026: «адрес в мытищах да»",
    confirmed: true,
  },
  shipping: {
    value: "Доставка транспортной компанией в любой регион",
    source: "слова владельца 22.09.2026: «либо доставка транспортной компанией в любой регион»",
    confirmed: true,
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
  inn: FACTS.inn.value,
  ogrnip: FACTS.ogrnip.value,
  leadTime: FACTS.leadTime.value,
  warrantyMonths: FACTS.warrantyMonths.value,
  measure: FACTS.measure.value,
  serviceArea: FACTS.serviceArea.value,
  shipping: FACTS.shipping.value,
  address: FACTS.address.value,
  // Приём заявок — публичный маршрут mglass-app (site_leads + Telegram владельцу).
  // Локально по умолчанию выключен: иначе проверка формы будит владельца.
  leadEndpoint: process.env.NEXT_PUBLIC_LEAD_ENDPOINT || (process.env.VERCEL ? "https://mglass-app.vercel.app/api/configurator/lead" : ""),
  // Заявки идут в AmoCRM родной формой amoCRM (владелец 22.09.2026): лид создаёт виджет
  // amoCRM в браузере посетителя, наш код в CRM не пишет. Форма «Сайт зеркал —
  // mglass-zerkala.ru», воронка «Продажи» → «Неразобранное», тег «сайт-зеркала».
  // id и hash — публичные, они и так видны в коде любой страницы с формой.
  amoForm: {
    id: "1747238",
    hash: "2600451b11da58393f828487c0dbbe0e",
    src: "https://forms.amocrm.ru/forms/assets/js/amoforms.js?1790069110",
  },
  productionDomain: "mglass-zerkala.ru",
  metrikaId: process.env.NEXT_PUBLIC_YM_ID || "",
  yandexVerification: process.env.NEXT_PUBLIC_YANDEX_VERIFICATION || "",
  // Дата последней правки текстов — идёт в lastmod карты сайта. Меняется руками
  // вместе с текстами: «сегодня» на каждой сборке Яндекс быстро перестаёт читать.
  contentUpdated: "2026-09-22",
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
