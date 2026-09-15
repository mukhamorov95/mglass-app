// Меню менеджера (MGlass B2C + B2B) — отдельно от Sidebar, чтобы тест мог сверить
// каждую ссылку со страницей и с доступом роли (__tests__/nav/managerMenu.test.ts).

export type NavItem  = { href: string; label: string; icon: string; indent?: boolean }
export type NavGroup = { groupLabel: string }
// Свёрнутая подменюшка: заголовок + свои пункты. Нужна там, где список длинный,
// а каждый день пользуются пятью пунктами (меню менеджера).
export type NavSection = { sectionLabel: string; icon: string; items: NavItem[] }
export type NavEntry = NavItem | NavGroup | NavSection

export function isGroup(e: NavEntry): e is NavGroup { return 'groupLabel' in e }
export function isSection(e: NavEntry): e is NavSection { return 'sectionLabel' in e }

// ─── Manager: AmoCRM Dashboard ────────────────────────────────────────────────

export const MANAGER_AMO: NavItem[] = [
  { href: '/manager', label: 'Сделки в AmoCRM', icon: '🎯' },
]

// ─── Manager: MGlass (B2C) ────────────────────────────────────────────────────

// Структура по ТЗ владельца 15.09 (docs/FINMODEL_MANAGER_ROUTE.md, Н1): Главная →
// Расчёты и документы → Исполнение → Личное. Страницы и доступы не менялись —
// пункты только переложены и переименованы. КП и договоры создаются из сделки,
// поэтому их реестры сложены в подменю, а не стоят на первом уровне.
export const MANAGER_MGLASS: NavEntry[] = [
  { groupLabel: 'Главная' },
  { href: '/my-day',            label: 'Мой день',         icon: '☀️' },
  { href: '/deals',             label: 'Сделки',           icon: '🤝' },
  { href: '/clients',           label: 'Клиенты',          icon: '👤' },
  { href: '/orders',            label: 'Заказы',           icon: '📦' },
  // Воронка — до продажи, реестр — фактические продажи и оплаты. Не дубли.
  { sectionLabel: 'Воронка и реестр продаж', icon: '📊', items: [
    { href: '/crm',               label: 'Воронка продаж',        icon: '📊' },
    { href: '/sales',             label: 'Реестр продаж и оплат', icon: '💰' },
  ] },

  { groupLabel: 'Расчёты и документы' },
  // Калькуляторы изделий по-прежнему нужны каждый день (#480), поэтому первыми в группе.
  { sectionLabel: 'Калькуляторы изделий', icon: '🧮', items: [
    { href: '/calculator/shower', label: 'Душевая',        icon: '🚿' },
    { href: '/calculator/mirror', label: 'Зеркало',        icon: '🪞' },
    { href: '/calculator/loft',   label: 'Лофт',           icon: '🏗️' },
    { href: '/configurator',      label: 'Визуализатор 3D', icon: '🧊' },
  ] },
  { href: '/calculator/build',  label: 'Новый расчёт',     icon: '🚿' },
  { href: '/calculator/quick',  label: 'Быстрый расчёт · черновик', icon: '⚡' },
  { href: '/calculations',      label: 'Расчёты',          icon: '📋' },
  { sectionLabel: 'КП и документы', icon: '📄', items: [
    { href: '/kp',                label: 'КП',               icon: '📄' },
    { href: '/contracts',         label: 'Договоры и счета', icon: '📃' },
  ] },

  { groupLabel: 'Исполнение' },
  { sectionLabel: 'Замеры', icon: '📐', items: [
    { href: '/measure-requests',  label: 'Заявки на замер',   icon: '📐' },
    { href: '/measure-calendar',  label: 'Календарь замеров', icon: '🗓️' },
    { href: '/measurer',          label: 'Форма замера',      icon: '📋' },
  ] },
  { href: '/installations',     label: 'Монтажи',           icon: '🔧' },
  // Не дубль: страница показывает и замеры, и монтажи.
  { href: '/calendar',          label: 'Календарь замеров и монтажей', icon: '📅' },
  { href: '/inventory',         label: 'Склад и резервы',   icon: '🏬' },

  { groupLabel: 'Личное' },
  { href: '/my-earnings',       label: 'Мои деньги',        icon: '💰' },
]

// ─── Manager: B2B ─────────────────────────────────────────────────────────────

// Продажи B2B. Раскрой и Production App — рабочее место цеха (ТЗ 4.1): статус
// производства менеджер видит в самом заказе. Доступ к цеху не закрыт.
export const MANAGER_B2B: NavItem[] = [
  { href: '/b2b-today',      label: 'Мой день · B2B',  icon: '☀️' },
  { href: '/calculator/b2b', label: 'B2B Калькулятор', icon: '🧮' },
  { href: '/calculator/b2b-mglass', label: 'Расчёт B2B для MGlass', icon: '🧾' },
  { href: '/b2b-quotes',     label: 'B2B Просчёты',    icon: '📝' },
  { href: '/b2b-orders',     label: 'B2B Заказы',      icon: '📦' },
  { href: '/b2b-invoices',   label: 'Счета B2B',       icon: '📒' },
  { href: '/b2b-crm',        label: 'B2B Клиенты',     icon: '🏢' },
]

