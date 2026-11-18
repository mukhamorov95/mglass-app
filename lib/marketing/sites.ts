import type { ChannelKey } from './channels'

// Реестр сайтов компании. Новый сайт появляется здесь вместе со своими каналами
// заявок — тогда «Статистика» сама начинает его считать.

export type SiteEntry = {
  domain: string
  url: string
  about: string
  engine: string
  deploy: string
  metrika: string
  goals: string
  search: string
  leads: string
  channels: ChannelKey[]
  linksTo: string[]
}

export const SITES: SiteEntry[] = [
  {
    domain: 'mglass-zerkala.ru',
    url: 'https://www.mglass-zerkala.ru',
    about: 'Зеркала на заказ: 49 страниц, страницы объектов с ценами',
    engine: 'Свой (Next.js, статичный) — sites/zerkala в репозитории',
    deploy: 'Архив через панель reg.ru, вручную',
    metrika: '112922124',
    goals: 'lead_form, phone_click, out_mglass_pro, out_vetro',
    search: 'Вебмастер, Search Console',
    leads: 'Форма amo → «Продажи», тег «сайт-зеркала»',
    channels: ['zerkala'],
    linksTo: ['mglass.pro'],
  },
  {
    domain: 'mglass.pro',
    url: 'https://mglass.pro',
    about: 'Душевые и шторки на ванну',
    engine: 'Tilda',
    deploy: 'Публикация в Tilda',
    metrika: '113436523 (наш) + 94295749 (подрядчика, через его GTM)',
    goals: 'Формы Tilda; цели старого счётчика — у подрядчика',
    search: 'Вебмастер, Search Console',
    leads: 'Формы Tilda, WhatsApp/Telegram, Envybox: звонок и чат',
    channels: ['mglassPro', 'siteMessengers', 'envybox', 'envyboxChat'],
    linksTo: [],
  },
  {
    domain: 'стеклянные-перегородки.рф',
    url: 'https://стеклянные-перегородки.рф',
    about: 'Стеклянные перегородки',
    engine: 'Tilda',
    deploy: 'Публикация в Tilda',
    metrika: '113440184 (наш) + 89188465 (старый)',
    goals: 'Формы Tilda',
    search: 'Вебмастер, Search Console',
    leads: 'Формы Tilda, Envybox',
    channels: ['peregorodki'],
    linksTo: [],
  },
]

// Что нужно новому сайту, чтобы его заявки и переходы считались с первого дня.
export const NEW_SITE_CHECKLIST = [
  'Домен и хостинг — на компанию; доступы — в менеджере паролей владельца',
  'Свой счётчик Метрики и цели: заявка, звонок, переходы на соседние сайты',
  'Форма amo со своим тегом — иначе заявки попадут в «Без признака»',
  'Ссылки на соседние сайты — с utm_source = домен сайта',
  'Вебмастер и Search Console, карта сайта',
  'Строка в этом реестре и канал в lib/marketing/channels.ts',
]
