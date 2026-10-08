// Меню менеджера (MGlass B2C + B2B) — отдельно от Sidebar, чтобы тест мог сверить
// каждую ссылку со страницей и с доступом роли (__tests__/nav/managerMenu.test.ts).

// ownerOnly — пункт видят только владельцы (admin, ceo), менеджеру он не показывается:
// так маржа живёт рядом с продажами, не уходя в менеджерское меню. orPermission —
// кроме владельцев, его видит тот, кому выдано это право (маржа — Вере, 05.10).
export type NavItem  = { href: string; label: string; icon: string; indent?: boolean; ownerOnly?: boolean; orPermission?: 'margin_edit' }
export type NavGroup = { groupLabel: string }
// Свёрнутая подменюшка: заголовок + свои пункты. Нужна там, где список длинный,
// а каждый день пользуются пятью пунктами (меню менеджера).
export type NavSection = { sectionLabel: string; icon: string; items: NavItem[] }
export type NavEntry = NavItem | NavGroup | NavSection

export function isGroup(e: NavEntry): e is NavGroup { return 'groupLabel' in e }
export const visibleFor = (i: NavItem, isOwner: boolean, perms?: { margin_edit?: boolean } | null) =>
  !i.ownerOnly || isOwner || (i.orPermission != null && perms?.[i.orPermission] === true)
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
  // «Мой день» и «Заказы» убраны 08.10 (docs/SYSTEM_ORDER_ROUTE.md, этап 8): первый
  // дублировал «Утро» на главной, во втором одна строка с 13.05. Адреса перенаправляют.
  { groupLabel: 'Главная' },
  { href: '/deals',             label: 'Сделки',           icon: '🤝' },
  { href: '/clients',           label: 'Клиенты',          icon: '👤' },
  // Воронка — до продажи, «Продажи M-Glass» — фактические продажи и оплаты
  // (книга «Продажи Мгласс»). Не дубли. Название — решение владельца 05.10.
  { sectionLabel: 'Воронка и продажи', icon: '📊', items: [
    { href: '/crm',               label: 'Воронка продаж',        icon: '📊' },
    { href: '/sales',             label: 'Продажи M-Glass',       icon: '💰' },
    // Третий срез: не сделки и не деньги по заказам, а работа менеджера —
    // разговоры, замеры, оплаты и полученные деньги за период.
    { href: '/sales/managers',    label: 'Показатели менеджеров', icon: '🏆' },
    // Четвёртый — маржа объектов по книге «Маржа» (просьба владельца 05.10).
    { href: '/sales/margin',      label: 'Маржа',                 icon: '📐', ownerOnly: true, orPermission: 'margin_edit' },
  ] },

  { groupLabel: 'Расчёты и документы' },
  // Старые калькуляторы душевой, зеркала и лофта убраны из меню решением владельца
  // 30.09.2026 (docs/MANAGER_UX_ROUTE.md): считать через «Новый расчёт» и «Быстрый».
  // Страницы и доступ остались — старые ссылки открываются.
  { href: '/calculator/build',  label: 'Новый расчёт',     icon: '🚿' },
  { href: '/calculator/quick',  label: 'Быстрый расчёт · черновик', icon: '⚡' },
  { href: '/configurator',      label: 'Визуализатор 3D',  icon: '🧊' },
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
  { href: '/production-app/control', label: 'Табло цеха', icon: '🔥' },
  { href: '/b2b-crm/inquiries', label: 'Входящие заявки', icon: '📥' },
  { href: '/calculator/b2b', label: 'B2B Калькулятор', icon: '🧮' },
  { href: '/calculator/b2b-mglass', label: 'Расчёт B2B для MGlass', icon: '🧾' },
  { href: '/b2b-quotes',     label: 'B2B Просчёты',    icon: '📝' },
  { href: '/b2b-orders',     label: 'B2B Заказы',      icon: '📦' },
  { href: '/b2b-invoices',   label: 'Счета B2B',       icon: '📒' },
  { href: '/b2b-crm',        label: 'B2B Клиенты',     icon: '🏢' },
  { href: '/b2b-crm/report', label: 'Отчёт по клиентам', icon: '📈' },
]


// ─── AI (только владелец) ─────────────────────────────────────────────────────

// Раздел AI в рабочем месте «Менеджер», под MGlass и B2B (решение владельца 16.09).
// База знаний — на первом уровне: её наполняют постоянно. Экраны бота и агентов
// существовали и раньше, но были разбросаны по «СЕО» и «Админу».
export const OWNER_AI: NavEntry[] = [
  { href: '/ai/knowledge', label: 'База знаний', icon: '📚' },
  { sectionLabel: 'Бот Авито «Иван»', icon: '💬', items: [
    { href: '/admin/avito-funnel', label: 'Воронка бота',   icon: '📊' },
    { href: '/crm/bot-test',       label: 'Песочница бота', icon: '🧪' },
    { href: '/ai-stats',           label: 'Статистика AI',  icon: '📈' },
  ] },
  { sectionLabel: 'Агенты', icon: '⚡', items: [
    { href: '/admin/agents',            label: 'AI-агенты',         icon: '⚡' },
    { href: '/admin/ai-control-center', label: 'AI Control Center', icon: '🎛️' },
  ] },
]
