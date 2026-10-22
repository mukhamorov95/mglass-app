import type { NavEntry, NavGroup, NavItem } from '@/lib/nav/managerMenu'
import { isGroup, isSection } from '@/lib/nav/managerMenu'

// Меню владельца по контурам (docs/nav/NAV_CONTOURS_ROUTE.md): переключатель у логотипа
// M-Glass · B2B · CEO, внутри каждого — одни и те же разделы по образцу КП «Лонг Кэт»
// (Главное, Продажи, Производство, Склад, Аналитика, Управление). Пункт из старого меню
// не удаляется — переезжает сюда или в «Редкое» (не открывался ни разу с 29.09, когда
// начали писать user_page_days). Сверка «ничего не потерялось» — __tests__/nav/contours.test.ts.

export type Contour = 'mglass' | 'b2b' | 'ceo'

export const CONTOUR_LABEL: Record<Contour, string> = { mglass: 'M-Glass', b2b: 'B2B', ceo: 'CEO' }

const MGLASS: NavEntry[] = [
  { groupLabel: 'Главное' },
  { href: '/',                   label: 'Главная · утро команды', icon: '🏠' },
  { groupLabel: 'Продажи' },
  { href: '/deals',              label: 'Сделки',            icon: '🤝' },
  { href: '/crm',                label: 'Воронка продаж',    icon: '📊' },
  { href: '/clients',            label: 'Клиенты',           icon: '👤' },
  { href: '/manager',            label: 'Сделки в AmoCRM',   icon: '🎯' },
  { sectionLabel: 'Калькулятор', icon: '🧮', items: [
    { href: '/calculator/build', label: 'Новый расчёт',      icon: '🚿' },
    { href: '/calculator/quick', label: 'Быстрый расчёт · черновик', icon: '⚡' },
    { href: '/calculator/b2b-mglass', label: 'Расчёт для M-Glass', icon: '🧾' },
    { href: '/configurator',     label: 'Визуализатор 3D',   icon: '🧊' },
  ] },
  { sectionLabel: 'Расчёты и документы', icon: '📄', items: [
    { href: '/calculations',     label: 'Расчёты',           icon: '📋' },
    { href: '/kp',               label: 'КП',                icon: '📄' },
    { href: '/contracts',        label: 'Договоры и счета',  icon: '📃' },
  ] },
  { groupLabel: 'Производство' },
  // Розничный заказ идёт в цех B2B-заказом клиента M GLASS — те же экраны с фильтром (Н2)
  { href: '/production-app/orders?client=mglass', label: 'Заказы в цеху',  icon: '📋' },
  { href: '/production-app/load?client=mglass',   label: 'Планирование',   icon: '🗓️' },
  { href: '/production-app/board?client=mglass',  label: 'Участки цеха',   icon: '🔧' },
  { sectionLabel: 'Замеры', icon: '📐', items: [
    { href: '/measure-requests',  label: 'Заявки на замер',   icon: '📐' },
    { href: '/measure-calendar',  label: 'Календарь замеров', icon: '🗓️' },
    { href: '/measurer-cabinet',  label: 'Кабинет замерщика', icon: '📏' },
    { href: '/measurer',          label: 'Форма замера',      icon: '📋' },
  ] },
  { sectionLabel: 'Монтаж', icon: '🔨', items: [
    { href: '/installations',     label: 'Монтажи',           icon: '🔧' },
    { href: '/calendar',          label: 'Календарь замеров и монтажей', icon: '📅' },
    { href: '/admin/route-sheet', label: 'Маршрутный лист',   icon: '🚚' },
    { href: '/admin/brigades',    label: 'Бригады',           icon: '👷' },
  ] },
  { groupLabel: 'Склад' },
  { href: '/inventory',          label: 'Остатки и резервы', icon: '🏬' },
  { href: '/purchasing',         label: 'Материал под заказы', icon: '📦' },
  { href: '/admin/procurement',  label: 'Поставки',          icon: '🗂️' },
  { href: '/admin/suppliers',    label: 'Поставщики',        icon: '🏭' },
  { groupLabel: 'Аналитика' },
  { href: '/sales',              label: 'Продажи M-Glass',   icon: '💰' },
  { href: '/sales/dynamics',     label: 'Динамика продаж',   icon: '📊' },
  { href: '/sales/managers',     label: 'Показатели менеджеров', icon: '🏆' },
  { href: '/sales/margin',       label: 'Маржа',             icon: '📐' },
  { href: '/commercial/activity', label: 'Рабочий день менеджеров', icon: '⏱️' },
  { href: '/my-earnings',        label: 'Мои деньги',        icon: '💰' },
  { href: '/measurer-earnings',  label: 'Заработок замерщиков', icon: '💰' },
  { groupLabel: 'Управление' },
  { sectionLabel: 'Зеркала', icon: '💡', items: [
    { href: '/admin/mirror-pricing',     label: 'Себестоимость зеркал', icon: '💡' },
    { href: '/admin/mirror-lighting',    label: 'Компоненты подсветки', icon: '🔌' },
    { href: '/admin/mirror-frames',      label: 'Рамки зеркал',         icon: '🖼️' },
    { href: '/admin/mirror-frame-rates', label: 'Зеркало в раме — ставки', icon: '🖼️' },
    { href: '/admin/pricing-v2',         label: 'Маржа / финмодель зеркал', icon: '📈' },
  ] },
  { sectionLabel: 'Душевые, лофт, ограждения', icon: '🚿', items: [
    { href: '/admin/shower-hardware',    label: 'Фурнитура душевых',     icon: '🚿' },
    { href: '/admin/visualizer-pricing', label: 'Себестоимость душевых', icon: '🧊' },
    { href: '/admin/hardware',           label: 'Фурнитура лофт',        icon: '🔩' },
    { href: '/admin/loft-rates',         label: 'Лофт — ставки цеха',    icon: '🏗️' },
    { href: '/admin/railing-rates',      label: 'Ограждение — ставки',   icon: '🪜' },
  ] },
  { sectionLabel: 'Поставщики и доставка', icon: '📗', items: [
    { href: '/admin/supplier-catalog',  label: 'Справочник цен',  icon: '📗' },
    { href: '/admin/suppliers/eleganz', label: 'Прайс Eleganz',   icon: '💡' },
    { href: '/admin/delivery-zones',    label: 'Зоны доставки',   icon: '🚗' },
  ] },
]

const B2B: NavEntry[] = [
  { groupLabel: 'Главное' },
  { href: '/b2b-today',          label: 'Мой день · B2B',    icon: '☀️' },
  { href: '/b2b-crm/inquiries',  label: 'Входящие заявки',   icon: '📥' },
  { groupLabel: 'Продажи' },
  { href: '/calculator/b2b',     label: 'Калькулятор',       icon: '🧮' },
  { href: '/b2b-quotes',         label: 'Просчёты',          icon: '📝' },
  { href: '/b2b-orders',         label: 'Заказы',            icon: '📦' },
  { href: '/b2b-invoices',       label: 'Счета',             icon: '📒' },
  { href: '/b2b-crm',            label: 'Клиенты',           icon: '🏢' },
  { href: '/admin/b2b-access',   label: 'Доступ в кабинет клиенту', icon: '🔑' },
  { groupLabel: 'Производство' },
  { href: '/production-app/control', label: 'Табло цеха',    icon: '🔥' },
  { href: '/production-app/orders',  label: 'Заказы в цеху', icon: '📋' },
  { href: '/production-app/load',    label: 'Планирование',  icon: '🗓️' },
  { href: '/production-app/board',   label: 'Участки цеха',  icon: '🔧' },
  { href: '/b2b-cutting',            label: 'Раскрой стекла', icon: '✂️' },
  { href: '/production-app/shipping', label: 'Отгрузка',     icon: '📦' },
  { href: '/production-app/voronezh', label: 'Доставка в Воронеж', icon: '🚚' },
  { sectionLabel: 'Цех подробно', icon: '🏭', items: [
    { href: '/production-app',          label: 'Главная цеха',  icon: '📱' },
    { href: '/production-app/my-queue', label: 'Мои задачи',    icon: '✅' },
    { href: '/production-app/problems', label: 'Проблемы',      icon: '⚠️' },
    { href: '/production-app/scan',     label: 'Скан',          icon: '📷' },
    { href: '/production-app/activity', label: 'Кто что делал', icon: '👥' },
    { href: '/production-app/no-marks', label: 'Без отметок',   icon: '🕳' },
    { href: '/production-app/metrics',  label: 'Метрики цеха',  icon: '📈' },
    { href: '/production-app/docs',     label: 'Документы',     icon: '📄' },
    { href: '/production-app/money',    label: 'Деньги и план', icon: '💰' },
    { href: '/production-app/ideas',    label: 'Идеи и проблемы', icon: '💡' },
    { href: '/admin/ideas',             label: 'Идеи цеха — разбор', icon: '💡' },
    { href: '/production-app/guide',    label: 'Регламент работы', icon: '📘' },
  ] },
  { groupLabel: 'Склад' },
  { href: '/inventory',               label: 'Остатки',          icon: '🏬' },
  { href: '/production-app/remnants', label: 'Остатки листа',    icon: '🪟' },
  { href: '/production-app/material', label: 'Материал',         icon: '📦' },
  { href: '/production-app/buy',      label: 'Необходимо купить', icon: '🛒' },
  { href: '/purchasing',              label: 'Материал под заказы', icon: '📦' },
  { href: '/admin/procurement',       label: 'Поставки',         icon: '🗂️' },
  { groupLabel: 'Аналитика' },
  { href: '/b2b-crm/dynamics',    label: 'Динамика продаж B2B', icon: '📊' },
  { href: '/b2b-crm/report',      label: 'Отчёт по клиентам', icon: '📈' },
  { href: '/cfo/products',        label: 'Отчёт по изделиям', icon: '📊' },
  { href: '/admin/referral-stats', label: 'Партнёры — сводка', icon: '📊' },
  { href: '/admin/referrals',     label: 'Реферальная программа', icon: '🤝' },
  { groupLabel: 'Управление' },
  { sectionLabel: 'Стекло', icon: '🔷', items: [
    { href: '/admin/glass-prices', label: 'Стекло',          icon: '🔷' },
    { href: '/admin/b2b-rates',    label: 'Стекло — ставки', icon: '🧮' },
    { href: '/admin/facet',        label: 'Фацет',           icon: '💎' },
  ] },
  { sectionLabel: 'Справочники B2B', icon: '📚', items: [
    { href: '/admin/materials',        label: 'Материалы',            icon: '📦' },
    { href: '/admin/b2b-materials',    label: 'Материалы B2B',        icon: '🪟' },
    { href: '/admin/b2b-services',     label: 'Услуги',               icon: '🔧' },
    { href: '/admin/b2b-surcharges',   label: 'Надбавки за габариты', icon: '📐' },
    { href: '/admin/sandblast-cost',   label: 'Себестоимость пескоструя', icon: '🪨' },
    { href: '/admin/cutting-settings', label: 'Настройки раскроя',    icon: '✂️' },
    { href: '/admin/b2b-clients',      label: 'Клиенты — справочник', icon: '🏢' },
  ] },
]

const CEO: NavEntry[] = [
  { groupLabel: 'Главное' },
  { href: '/admin/owner',        label: 'Owner Center',      icon: '🏛️' },
  { href: '/admin/owner-tasks',  label: 'Задачи владельца',  icon: '📋' },
  { href: '/ceo',                label: 'CEO — обзор бизнеса', icon: '👑' },
  { href: '/sales/dynamics',     label: 'Динамика M-Glass',  icon: '📊' },
  { href: '/b2b-crm/dynamics',   label: 'Динамика B2B',      icon: '📊' },
  { href: '/admin/sales-control', label: 'Контроль продаж',  icon: '🎯' },
  { groupLabel: 'Финансы' },
  { href: '/cfo',                label: 'Дашборд CFO',       icon: '📊' },
  { href: '/accounting',         label: 'Бухгалтерия',       icon: '🧾' },
  { href: '/cfo/receivables',    label: 'Дебиторка',         icon: '💸' },
  { href: '/cfo/invoices',       label: 'Реестр счетов',     icon: '📄' },
  { href: '/cfo/cashflow',       label: 'ДДС · календарь',   icon: '📅' },
  { sectionLabel: 'Прибыль и маржа', icon: '📈', items: [
    { href: '/admin/pnl',                    label: 'P&L',               icon: '📈' },
    { href: '/cfo/sales-ledger',             label: 'Продажи и маржа',   icon: '🧮' },
    { href: '/cfo/margins',                  label: 'Маржинальность',    icon: '📈' },
    { href: '/cfo/products',                 label: 'Отчёт по изделиям', icon: '📊' },
    { href: '/cfo/order-economics',          label: 'Экономика заказов', icon: '🧾' },
    { href: '/cfo/order-economics/retail',   label: 'Фонды розницы',     icon: '🚿' },
    { href: '/cfo/unit',                     label: 'Unit-экономика',    icon: '🔍' },
    { href: '/cfo/breakeven',                label: 'Точка безубыточности', icon: '🎯' },
    { href: '/cfo/model',                    label: 'Финмодель · факт/сценарии', icon: '📐' },
  ] },
  { sectionLabel: 'Настройки финансов', icon: '⚙️', items: [
    { href: '/admin/cfo?tab=settings', label: 'Налог и расходы CFO', icon: '💰' },
    { href: '/admin/settings',         label: 'Фин. настройки',      icon: '⚙️' },
  ] },
  { groupLabel: 'Аналитика' },
  { href: '/commercial',         label: 'Коммерческий',      icon: '📈' },
  { href: '/commercial/activity', label: 'Рабочий день (AMO)', icon: '⏱️' },
  { groupLabel: 'AI' },
  { href: '/admin/ai-control-center', label: 'AI Control Center', icon: '🎛️' },
  { href: '/ai/knowledge',       label: 'База знаний',       icon: '📚' },
  { groupLabel: 'Управление' },
  { href: '/admin/users',        label: 'Пользователи',      icon: '👥' },
  { href: '/admin/org',          label: 'Оргструктура',      icon: '🏛️' },
  { href: '/admin/access-check', label: 'Диагностика прав',  icon: '🔎' },
  { href: '/admin/activity-log', label: 'Лог действий',      icon: '🧾' },
  { href: '/admin/activity',     label: 'Активность',        icon: '⏱️' },
  { href: '/admin/security',     label: 'Безопасность',      icon: '🛡️' },
  { href: '/admin/infrastructure', label: 'Техцентр',        icon: '⚙️' },
  { href: '/admin/services',     label: 'Платные сервисы',   icon: '💳' },
]

// Ни разу не открывались с 29.09 (user_page_days, замер 14.10). Справочники B2B,
// «Задачи владельца» и CEO-обзор сюда не убраны, хотя тоже без заходов: это место,
// где задают цены и ставят задачи, — им положено открываться редко.
export const RARE: NavItem[] = [
  { href: '/marketing',                 label: 'Marketing Center',    icon: '📣' },
  { href: '/marketing/seo',             label: 'SEO · Заявки сайта',  icon: '🔍' },
  { href: '/marketing/content',         label: 'Контент-план',        icon: '📅' },
  { href: '/marketing/video-factory',   label: 'AI Video Factory',    icon: '🎬' },
  { href: '/marketing/media-library',   label: 'Медиабиблиотека',     icon: '🖼️' },
  { href: '/marketing/daily',           label: 'Дневной план AI',     icon: '☀️' },
  { href: '/marketing/partners',        label: 'Маркетинг — партнёры', icon: '🤝' },
  { href: '/marketing/promos',          label: 'Акции',               icon: '🏷️' },
  { href: '/marketing/tasks',           label: 'Задачи маркетинга',   icon: '✅' },
  { href: '/marketing/ai',              label: 'AI-маркетолог',       icon: '🤖' },
  { href: '/marketing/promo',           label: 'Пульт продвижения',   icon: '💲' },
  { href: '/marketing/promo/pipeline',  label: 'Конвейер роликов',    icon: '🏭' },
  { href: '/marketing/promo/guide',     label: 'Регламент продвижения', icon: '📖' },
  { href: '/vladislav',                 label: 'Сообщения (Vladislav AI)', icon: '💬' },
  { href: '/vladislav/calls',           label: 'Анализ звонков',      icon: '📞' },
  { href: '/vladislav/manager-stats',   label: 'Аналитика менеджеров (AI)', icon: '👥' },
  { href: '/vladislav/tasks',           label: 'Задачи AI',           icon: '🗂️' },
  { href: '/ai-stats',                  label: 'Статистика бота',     icon: '📈' },
  { href: '/amo-analysis',              label: 'Воронка AMO',         icon: '🔍' },
  { href: '/admin/integrations',        label: 'Avito / AMO Monitor', icon: '🔗' },
  { href: '/admin/avito-funnel',        label: 'Воронка бота Авито',  icon: '🤖' },
  { href: '/crm/bot-test',              label: 'Песочница бота',      icon: '🧪' },
  { href: '/admin/agents',              label: 'AI-агенты',           icon: '⚡' },
  { href: '/admin/ai-b2b-quote',        label: 'AI B2B Quote',        icon: '⚡' },
  { href: '/commercial/churn',          label: 'Отток клиентов',      icon: '📉' },
  { href: '/b2b-growth',                label: 'Развитие B2B',        icon: '🚀' },
  { href: '/admin/b2b-flow',            label: 'Поток заказов B2B',   icon: '📊' },
  { href: '/admin/margin-audit',        label: 'Аудит маржи',         icon: '📉' },
  { href: '/admin/archive',             label: 'Архив расчётов',      icon: '📁' },
  { href: '/admin/quote-quality',       label: 'Полнота просчёта',    icon: '📐' },
  { href: '/admin/product-line',        label: 'Продуктовая линейка', icon: '📦' },
  { href: '/admin/product-line/catalog', label: 'Каталог серий',      icon: '🪞' },
  { href: '/admin/b2b-presentation',    label: 'B2B Презентация',     icon: '🎯' },
  { href: '/admin/data-hub',            label: 'Центр данных',        icon: '🔗' },
  { href: '/admin/architecture',        label: 'Карта данных',        icon: '🗺️' },
  { href: '/admin/pricing-manual',      label: 'Pricing Manual',      icon: '📖' },
  { href: '/admin/owner-questionnaire', label: 'Стратегия',           icon: '🎯' },
  { href: '/admin/roadmap',             label: 'Roadmap',             icon: '🗺️' },
  { href: '/admin/adoption',            label: 'Внедрение',           icon: '📈' },
  { href: '/admin/shower-images',       label: 'Media Library',       icon: '🖼️' },
  { href: '/admin/video-studio',        label: 'Видеостудия',         icon: '🎥' },
  { href: '/production-app/earnings',   label: 'Мой заработок (цех)', icon: '🤝' },
]

export const CONTOURS: Record<Contour, NavEntry[]> = { mglass: MGLASS, b2b: B2B, ceo: CEO }

// Разделы, раскрытые при входе. Владелец 21.10 про B2B: «всё свёрнуто, раскрыты только
// продажи» — «Главное» с входящими заявками тоже открыто. В CEO продаж нет — открыто всё.
// Раздел с открытой страницей раскрывается всегда (groupOf).
export const OPEN_GROUPS: Record<Contour, string[] | 'all'> = {
  mglass: ['Главное', 'Продажи'],
  b2b: ['Главное', 'Продажи'],
  ceo: 'all',
}

export type GroupBlock = { label: string; entries: NavEntry[] }

// Плоский список меню → разделы «заголовок + пункты до следующего заголовка».
export function groupBlocks(entries: NavEntry[]): GroupBlock[] {
  const out: GroupBlock[] = []
  for (const e of entries) {
    if ('groupLabel' in e) out.push({ label: (e as NavGroup).groupLabel, entries: [] })
    else if (out.length) out[out.length - 1].entries.push(e)
    else out.push({ label: '', entries: [e] })
  }
  return out
}

// Раздел, в котором лежит пункт открытой страницы (самое длинное совпадение адреса).
export function groupOf(pathname: string, entries: NavEntry[]): string | null {
  let best: string | null = null
  let bestLen = 0
  for (const b of groupBlocks(entries)) {
    const len = bestMatch(pathname, b.entries)
    if (len > bestLen) { best = b.label; bestLen = len }
  }
  return best
}

export function openGroups(pathname: string, c: Contour): string[] {
  const blocks = groupBlocks(CONTOURS[c])
  const conf = OPEN_GROUPS[c]
  const open = conf === 'all' ? blocks.map(b => b.label) : blocks.map(b => b.label).filter(l => conf.includes(l))
  const active = groupOf(pathname, CONTOURS[c])
  if (active !== null && !open.includes(active)) open.push(active)
  return open
}

const pathOf = (href: string) => href.split('?')[0]

export function itemsOf(entries: NavEntry[]): NavItem[] {
  return entries.flatMap(e => (isGroup(e) ? [] : isSection(e) ? e.items : [e]))
}

// Пункт, ведущий на этот адрес: точное совпадение или самый длинный префикс-раздел.
// Корень «/» совпадает только сам с собой — иначе он подходил бы ко всему.
export function matchLength(pathname: string, href: string): number {
  const p = pathOf(href)
  if (pathname === p) return p.length + 1
  if (p !== '/' && pathname.startsWith(p + '/')) return p.length
  return 0
}

export function bestMatch(pathname: string, entries: NavEntry[]): number {
  return Math.max(0, ...itemsOf(entries).map(i => matchLength(pathname, i.href)))
}

// Контур, в котором лежит открытый адрес. Текущий выигрывает при равенстве — общие
// пункты (склад, цех) не перебрасывают владельца между вкладками.
export function contourFor(pathname: string, current: Contour): Contour {
  let best: Contour = current
  let bestLen = bestMatch(pathname, CONTOURS[current])
  for (const c of Object.keys(CONTOURS) as Contour[]) {
    const len = bestMatch(pathname, CONTOURS[c])
    if (len > bestLen) { best = c; bestLen = len }
  }
  return best
}
