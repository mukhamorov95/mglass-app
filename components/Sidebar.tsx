'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import type { Role } from '@/lib/getRole'
import type { UserPermissions } from '@/lib/permissions'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions'
import { hasB2BSalesScope, isAllClientsScope } from '@/lib/b2bScope'

type Props = { userEmail: string; role: Role | null; permissions?: UserPermissions; canViewMoney?: boolean; referralRate?: number | null }
type SyncState = 'idle' | 'loading' | 'ok' | 'error'
type ViewMode = 'manager' | 'admin' | 'ceo' | 'cfo' | 'production' | 'measurer'

type NavItem  = { href: string; label: string; icon: string; indent?: boolean }
type NavGroup = { groupLabel: string }
type NavEntry = NavItem | NavGroup

function isGroup(e: NavEntry): e is NavGroup { return 'groupLabel' in e }

// ─── Manager: AmoCRM Dashboard ────────────────────────────────────────────────

const MANAGER_AMO: NavItem[] = [
  { href: '/manager', label: 'Мои сделки (AmoCRM)', icon: '🎯' },
]

// ─── Manager: MGlass (B2C) ────────────────────────────────────────────────────

const MANAGER_MGLASS: NavEntry[] = [
  { groupLabel: 'Калькуляторы' },
  { href: '/calculator/quick',  label: 'Быстрый расчёт',   icon: '⚡' },
  { href: '/design-scan',       label: 'Скан дизайн-проекта', icon: '🔍' },
  { href: '/calculator/mirror', label: 'Зеркало',          icon: '🪞' },
  { href: '/calculator/shower', label: 'Душевая',          icon: '🚿' },
  { href: '/configurator',      label: 'Визуализатор 3D',  icon: '🧊' },
  { href: '/calculator/loft',   label: 'Лофт-перегородка', icon: '🏗️' },
  { href: '/calculator/railing', label: 'Лестн. ограждение', icon: '🪜' },
  { groupLabel: 'Продажи' },
  { href: '/crm',           label: 'CRM · Продажи',    icon: '📊' },
  { href: '/sales',         label: 'Отдел продаж',     icon: '💰' },
  { href: '/kp',            label: 'КП',               icon: '📄' },
  { href: '/contracts',     label: 'Договор/Счёт',     icon: '📃' },
  { href: '/calculations',  label: 'История расчётов', icon: '📋' },
  { href: '/orders',        label: 'Заказы',           icon: '📦' },
  { href: '/inventory',     label: 'Склад (остатки)',  icon: '🏬' },
  { href: '/clients',       label: 'Клиенты',          icon: '👤' },
  { href: '/calendar',      label: 'Календарь',        icon: '📅' },
  { href: '/measure-requests', label: 'Заявки на замер', icon: '📐' },
  { href: '/installations', label: 'Монтажи',          icon: '🔧' },
  { href: '/measure-calendar', label: 'Календарь замеров', icon: '🗓️' },
  { href: '/measurer',      label: 'Форма замера',      icon: '📋' },
  { href: '/my-earnings',   label: 'Мои заработки',    icon: '💰' },
]

// ─── Manager: B2B ─────────────────────────────────────────────────────────────

const MANAGER_B2B: NavItem[] = [
  { href: '/b2b-today',      label: 'Мой день · B2B',  icon: '☀️' },
  { href: '/calculator/b2b', label: 'B2B Калькулятор', icon: '🧮' },
  { href: '/b2b-quotes',     label: 'B2B Просчёты',    icon: '📝' },
  { href: '/b2b-orders',     label: 'B2B Заказы',      icon: '📦' },
  { href: '/b2b-invoices',   label: 'Счета B2B',       icon: '📒' },
  { href: '/b2b-crm',        label: 'B2B Клиенты',     icon: '🏢' },
  { href: '/b2b-cutting',    label: 'Раскрой стекла',  icon: '✂️' },
  { href: '/production-app', label: 'Production App',  icon: '📱' },
]

// ─── Buyer role ───────────────────────────────────────────────────────────────

const BUYER_SKLAD: NavItem[] = [
  { href: '/inventory',           label: 'Склад — остатки',     icon: '🏬', indent: true },
]

const BUYER_ZAKUPKI: NavItem[] = [
  { href: '/admin/procurement',     label: 'Канбан закупок',    icon: '🗂️', indent: true },
  { href: '/accounting',            label: 'Заявки на оплату',  icon: '💸', indent: true },
  { href: '/admin/suppliers',       label: 'Поставщики',        icon: '🏭', indent: true },
  { href: '/admin/supplier-catalog', label: 'Справочник цен',   icon: '📗', indent: true },
  { href: '/admin/visualizer-pricing', label: 'Себестоимость визуализатора', icon: '🧊', indent: true },
  { href: '/admin/shower-hardware', label: 'Фурнитура душевых', icon: '🚿', indent: true },
  { href: '/admin/hardware',        label: 'Фурнитура лофт',   icon: '🔩', indent: true },
]

const BUYER_LOGISTIKA: NavItem[] = [
  { href: '/admin/route-sheet',        label: 'Доставки клиентам',      icon: '📍', indent: true },
  { href: '/orders',                   label: 'Заказы MGlass',          icon: '📦', indent: true },
  { href: '/b2b-orders',               label: 'Заказы B2B',             icon: '🏢', indent: true },
]

const BUYER_SPRAVOCHNIKI: NavItem[] = [
  { href: '/admin/glass-prices',     label: 'Стекло',             icon: '🔷', indent: true },
  { href: '/admin/facet',            label: 'Фацет',              icon: '💎', indent: true },
  { href: '/admin/mirror-lighting',  label: 'Подсветка зеркал',  icon: '💡', indent: true },
  { href: '/admin/mirror-frames',    label: 'Рамки зеркал',      icon: '🖼️', indent: true },
  { href: '/admin/services',         label: 'Услуги',             icon: '🔧', indent: true },
  { href: '/admin/cutting-settings', label: 'Настройки раскроя', icon: '✂️', indent: true },
]

const BUYER_POMOSH: NavItem[] = [
  { href: '/admin/guide', label: 'Регламент', icon: '📖', indent: true },
]

// Scoped B2B menu for a buyer locked to M GLASS (b2b_client_scope='mglass_only').
// Trimmed to the internal quote→order→cutting flow (без списка клиентов).
const BUYER_B2B_MGLASS: NavItem[] = [
  { href: '/calculator/b2b', label: 'B2B Калькулятор', icon: '🧮', indent: true },
  { href: '/b2b-quotes',     label: 'B2B Просчёты',    icon: '📝', indent: true },
  { href: '/b2b-orders',     label: 'B2B Заказы',      icon: '📦', indent: true },
  { href: '/b2b-invoices',   label: 'Счета B2B',       icon: '📒', indent: true },
  { href: '/b2b-cutting',    label: 'Раскрой стекла',  icon: '✂️', indent: true },
]

// Полный B2B для закупщика со скоупом all_clients (Вера считает всем клиентам).
const BUYER_B2B_ALL: NavItem[] = [
  { href: '/calculator/b2b', label: 'B2B Калькулятор', icon: '🧮', indent: true },
  { href: '/b2b-quotes',     label: 'B2B Просчёты',    icon: '📝', indent: true },
  { href: '/b2b-orders',     label: 'B2B Заказы',      icon: '📦', indent: true },
  { href: '/b2b-invoices',   label: 'Счета B2B',       icon: '📒', indent: true },
  { href: '/b2b-crm',        label: 'B2B Клиенты',     icon: '🏢', indent: true },
  { href: '/b2b-cutting',    label: 'Раскрой стекла',  icon: '✂️', indent: true },
]

// Production oversight for the scoped buyer (Вера надзирает за цехом).
const BUYER_PRODUCTION: NavItem[] = [
  { href: '/production-app',            label: 'Производство',        icon: '📱', indent: true },
]

// ─── SEO role ─────────────────────────────────────────────────────────────────

const SEO_ANALYTICS: NavItem[] = [
  { href: '/marketing/seo', label: 'SEO · Заявки сайта', icon: '🌐' },
  { href: '/b2b-analytics', label: 'B2B Аналитика', icon: '📊' },
  { href: '/b2b-growth',    label: 'Развитие B2B',  icon: '🚀' },
  { href: '/ai-stats',      label: 'Статистика AI', icon: '📈' },
  { href: '/amo-analysis',  label: 'Воронка AMO',   icon: '🔍' },
  { href: '/ai-sales',      label: 'AI Продажи',    icon: '🤝' },
]

const SEO_MARKETING: NavItem[] = [
  { href: '/marketing',               label: 'Marketing Center', icon: '📣' },
  { href: '/marketing/content',       label: 'Контент-план',     icon: '📅' },
  { href: '/marketing/video-factory', label: 'AI Video Factory', icon: '🎬' },
  { href: '/marketing/media-library', label: 'Медиабиблиотека',  icon: '🖼️' },
  { href: '/marketing/daily',         label: 'Дневной план AI',  icon: '✨' },
  { href: '/marketing/partners',      label: 'Партнёры',         icon: '🤝' },
  { href: '/marketing/promos',        label: 'Акции',            icon: '🎁' },
  { href: '/marketing/tasks',         label: 'Задачи',           icon: '✅' },
  { href: '/marketing/ai',            label: 'AI-маркетолог',    icon: '🤖' },
]

const SEO_AI: NavItem[] = [
  { href: '/ai-assistant',  label: 'AI Ассистент', icon: '🤖' },
  { href: '/kp-generator',  label: 'КП Генератор', icon: '📄' },
  { href: '/vladislav',     label: 'Vladislav AI', icon: '💬' },
]

// ─── CFO role ─────────────────────────────────────────────────────────────────

const CFO_ITEMS: NavItem[] = [
  { href: '/cfo',          label: 'Дашборд CFO',       icon: '📊' },
  { href: '/cfo/model',    label: 'Финмодель · факт/сценарии', icon: '📐' },
  { href: '/accounting',   label: 'Бухгалтерия',       icon: '🧾' },
  { href: '/cfo/receivables', label: 'Дебиторка',      icon: '💸' },
  { href: '/cfo/invoices', label: 'Реестр счетов',     icon: '📄' },
  { href: '/cfo/cashflow', label: 'ДДС · календарь',   icon: '📅' },
  { href: '/cfo/sales-ledger', label: 'Продажи и маржа', icon: '🧮' },
  { href: '/cfo/margins',  label: 'Маржинальность',    icon: '📈' },
  { href: '/cfo/unit',     label: 'Unit-экономика',    icon: '🔍' },
  { href: '/cfo/breakeven', label: 'Точка безубыточности', icon: '🎯' },
  { href: '/admin/cfo',    label: 'Финмодели / ДДС',   icon: '💰' },
  { href: '/admin/settings', label: 'Фин. настройки', icon: '⚙️' },
]

// ─── CEO role ─────────────────────────────────────────────────────────────────

const CEO_OWNER: NavItem[] = [
  { href: '/admin/ai-control-center', label: 'AI Control Center', icon: '🧠' },
  { href: '/admin/owner',             label: 'Owner Center',      icon: '👑' },
  { href: '/admin/dashboard',         label: 'Дашборд',           icon: '📊' },
  { href: '/cfo',                     label: 'CFO Center',        icon: '💎' },
  { href: '/admin/pnl',              label: 'P&L отчёт',       icon: '📈' },
  { href: '/admin/analytics-mglass', label: 'Аналитика',       icon: '🔍' },
  { href: '/admin/bonus-center',     label: 'Bonus Center',    icon: '🎁' },
  { href: '/admin/sales-center',     label: 'Sales Center',    icon: '📣' },
  { href: '/admin/sales-control',    label: 'Контроль продаж', icon: '📊' },
  { href: '/admin/b2b-development',  label: 'B2B Development', icon: '🤝' },
  { href: '/admin/org',              label: 'Оргструктура',    icon: '🏗️' },
  { href: '/admin/users',            label: 'Пользователи',    icon: '👥' },
  { href: '/admin/activity-log',     label: 'Лог действий',   icon: '📋' },
  { href: '/production-app',               label: 'Production App',      icon: '📱' },
]

const CEO_ANALYTICS: NavItem[] = [
  { href: '/marketing/seo', label: 'SEO · Заявки сайта', icon: '🌐' },
  { href: '/b2b-analytics', label: 'B2B Аналитика', icon: '📊' },
  { href: '/vladislav',     label: 'Vladislav AI',  icon: '💬' },
  { href: '/marketing',     label: 'Маркетинг',     icon: '📣' },
  { href: '/ai-stats',      label: 'Статистика AI', icon: '📈' },
  { href: '/amo-analysis',  label: 'Воронка AMO',   icon: '🔍' },
  { href: '/ai-sales',      label: 'AI Продажи',    icon: '🤝' },
]

const CEO_SYSTEM: NavItem[] = [
  { href: '/admin/pricing-manual',      label: 'Pricing Manual', icon: '📖' },
  { href: '/admin/owner-questionnaire', label: 'Стратегия',      icon: '🎯' },
  { href: '/admin/roadmap',             label: 'Roadmap',        icon: '🗺️' },
  { href: '/admin/adoption',            label: 'Внедрение',      icon: '📈' },
]

// ─── Admin mode: CEO view ─────────────────────────────────────────────────────

const ADMIN_OWNER: NavItem[] = [
  { href: '/admin/progress',          label: 'Прогресс работ',    icon: '🗺️' },
  { href: '/admin/ai-control-center', label: 'AI Control Center', icon: '🧠' },
  { href: '/admin/owner',             label: 'Owner Center',      icon: '👑' },
  { href: '/admin/dashboard',         label: 'Дашборд',           icon: '📊' },
  { href: '/admin/pnl',              label: 'P&L отчёт',       icon: '📈' },
  { href: '/admin/cfo',              label: 'Финдиректор',      icon: '💰' },
  { href: '/admin/analytics-mglass', label: 'Аналитика',       icon: '🔍' },
  { href: '/admin/bonus-center',     label: 'Bonus Center',    icon: '🎁' },
  { href: '/admin/sales-center',     label: 'Sales Center',    icon: '📣' },
  { href: '/admin/sales-control',    label: 'Контроль продаж', icon: '📊' },
  { href: '/admin/b2b-development',  label: 'B2B Development', icon: '🤝' },
  { href: '/admin/org',              label: 'Оргструктура',    icon: '🏗️' },
  { href: '/admin/users',            label: 'Пользователи',    icon: '👥' },
  { href: '/admin/access-check',     label: 'Диагностика прав', icon: '🔎' },
  { href: '/admin/activity-log',          label: 'Лог действий',        icon: '📋' },
  { href: '/production-app',              label: 'Production App',      icon: '📱' },
]

const ADMIN_MARKETING: NavItem[] = [
  { href: '/marketing/seo',           label: 'SEO · Заявки сайта', icon: '🌐' },
  { href: '/marketing',               label: 'Marketing Center', icon: '📣' },
  { href: '/marketing/content',       label: 'Контент-план',     icon: '📅' },
  { href: '/marketing/video-factory', label: 'AI Video Factory', icon: '🎬' },
  { href: '/marketing/media-library', label: 'Медиабиблиотека',  icon: '🖼️' },
  { href: '/marketing/daily',         label: 'Дневной план AI',  icon: '✨' },
  { href: '/marketing/partners',      label: 'Партнёры',         icon: '🤝' },
  { href: '/marketing/promos',        label: 'Акции',            icon: '🎁' },
  { href: '/marketing/tasks',         label: 'Задачи',           icon: '✅' },
  { href: '/marketing/ai',            label: 'AI-маркетолог',    icon: '🤖' },
]

const ADMIN_VLADISLAV: NavItem[] = [
  { href: '/commercial',              label: 'Коммерческий',         icon: '📈' },
  { href: '/commercial/churn',        label: 'Отток клиентов',       icon: '📉' },
  { href: '/ceo',                     label: 'CEO Обзор',            icon: '👑' },
  { href: '/vladislav',               label: 'Сообщения',            icon: '💬' },
  { href: '/vladislav/calls',         label: 'Анализ звонков',       icon: '📞' },
  { href: '/ai-stats',                label: 'Статистика бота',      icon: '📊' },
  { href: '/vladislav/manager-stats', label: 'Аналитика менеджеров', icon: '👥' },
  { href: '/amo-analysis',            label: 'Воронка AMO',          icon: '🔍' },
  { href: '/vladislav/tasks',         label: 'Задачи AI',            icon: '🗂️' },
  { href: '/admin/integrations',      label: 'Avito / AMO Monitor',  icon: '🔗' },
]

const ADMIN_PRODUCT_LINE: NavItem[] = [
  { href: '/admin/product-line',         label: 'Продуктовая линейка', icon: '📦' },
  { href: '/admin/product-line/catalog', label: 'Каталог серий',       icon: '🪞' },
  { href: '/admin/b2b-presentation',     label: 'B2B Презентация',     icon: '🎯' },
]

const ADMIN_SYSTEM: NavItem[] = [
  { href: '/admin/data-hub',            label: 'Центр данных',   icon: '🔗' },
  { href: '/admin/pricing-manual',      label: 'Pricing Manual', icon: '📖' },
  { href: '/admin/owner-questionnaire', label: 'Стратегия',      icon: '🎯' },
  { href: '/admin/roadmap',             label: 'Roadmap',        icon: '🗺️' },
  { href: '/admin/adoption',            label: 'Внедрение',      icon: '📈' },
  { href: '/admin/infrastructure',      label: 'Техцентр',       icon: '⚙️' },
  { href: '/admin/shower-images',       label: 'Media Library',  icon: '🖼️' },
  { href: '/admin/agents',              label: 'AI-агенты',      icon: '⚡' },
  { href: '/admin/architecture',        label: 'Карта данных',   icon: '🗺️' },
]

// ─── Admin mode: Admin view ───────────────────────────────────────────────────

const ADMIN_DIRECTORIES: NavEntry[] = [
  { groupLabel: 'Стекло и зеркала' },
  { href: '/admin/glass-prices',    label: 'Стекло',           icon: '🔷', indent: true },
  { href: '/admin/facet',           label: 'Фацет',            icon: '💎', indent: true },
  { href: '/admin/mirror-lighting', label: 'Подсветка зеркал', icon: '💡', indent: true },
  { href: '/admin/mirror-frames',   label: 'Рамки зеркал',     icon: '🖼️', indent: true },
  { href: '/admin/pricing-v2',      label: 'Маржа / финмодель зеркал', icon: '📈', indent: true },
  { groupLabel: 'Фурнитура' },
  { href: '/admin/shower-hardware', label: 'Душевые',          icon: '🚿', indent: true },
  { href: '/admin/visualizer-pricing', label: 'Себестоимость визуализатора', icon: '🧊', indent: true },
  { href: '/admin/hardware',        label: 'Лофт',             icon: '🔩', indent: true },
  { href: '/admin/loft-rates',      label: 'Лофт — ставки цеха', icon: '🏗️', indent: true },
  { href: '/admin/mirror-frame-rates', label: 'Зеркало в раме — ставки', icon: '🖼️', indent: true },
  { href: '/admin/railing-rates',   label: 'Ограждение — ставки', icon: '🪜', indent: true },
  { groupLabel: 'Закупки' },
  { href: '/admin/procurement',       label: 'Канбан закупок', icon: '🗂️', indent: true },
  { href: '/admin/suppliers',         label: 'Поставщики',     icon: '🏭', indent: true },
  { href: '/admin/supplier-catalog',  label: 'Справочник цен', icon: '📗', indent: true },
  { href: '/admin/suppliers/eleganz', label: 'Прайс Eleganz',  icon: '💡', indent: true },
  { groupLabel: 'Производство' },
  { href: '/admin/materials', label: 'Материалы', icon: '📦', indent: true },
  { href: '/admin/services',  label: 'Услуги',    icon: '🔧', indent: true },
  { groupLabel: 'Финансы' },
  { href: '/admin/settings', label: 'Фин. настройки', icon: '💰', indent: true },
]

const ADMIN_B2B: NavEntry[] = [
  { href: '/b2b-growth',             label: 'Развитие B2B',      icon: '🚀' },
  { href: '/admin/b2b-clients',      label: 'Клиенты',           icon: '🏢' },
  { href: '/admin/b2b-services',     label: 'Услуги',            icon: '🔧' },
  { href: '/admin/b2b-materials',    label: 'Материалы',         icon: '🪟' },
  { href: '/admin/cutting-settings', label: 'Настройки раскроя', icon: '✂️' },
  { href: '/admin/margin-audit',     label: 'Аудит маржи',       icon: '📉' },
  { href: '/admin/archive',          label: 'Архив расчётов',    icon: '📁' },
  { href: '/admin/ai-b2b-quote',     label: 'AI B2B Quote',      icon: '⚡' },
]

const ADMIN_OPERATIONS: NavItem[] = [
  { href: '/measure-requests',    label: 'Заявки на замер',  icon: '📐' },
  { href: '/measure-calendar',    label: 'Календарь замеров', icon: '🗓️' },
  { href: '/measurer-cabinet',    label: 'Замерщики (календарь/деньги)', icon: '📏' },
  { href: '/admin/installations', label: 'Монтажи',          icon: '🔧' },
  { href: '/inventory',            label: 'Склад',           icon: '🏬' },
  { href: '/admin/route-sheet',    label: 'Маршрутный лист', icon: '🚚' },
  { href: '/admin/brigades',       label: 'Бригады',         icon: '👷' },
  { href: '/admin/delivery-zones', label: 'Зоны доставки',   icon: '🚗' },
  { href: '/admin/ideas',          label: 'Идеи цеха',       icon: '💡' },
  { href: '/admin/referrals',      label: 'Реферальная программа', icon: '🤝' },
  { href: '/admin/referral-stats', label: 'Партнёры — сводка', icon: '📊' },
  { href: '/admin/security',       label: 'Безопасность',    icon: '🛡️' },
  { href: '/admin/activity',       label: 'Активность',      icon: '⏱️' },
]

// ─── Production mode (admin viewMode) ────────────────────────────────────────

// Цех — по частоте использования: сверху то, где мастер живёт каждый день
// (задачи → заказы → скан), ниже — экраны начальника, в конце — логистика/аналитика.
const PRODUCTION_NAV_SHOP: NavItem[] = [
  { href: '/production-app/my-queue', label: 'Мои задачи',       icon: '✅' },
  { href: '/production-app/orders',   label: 'Заказы',           icon: '📋' },
  { href: '/production-app/problems', label: 'Проблемы',         icon: '⚠️' },
  { href: '/production-app/board',    label: 'Обзор цеха',       icon: '🔧' },
  { href: '/production-app/shipping', label: 'Отгрузка',            icon: '📦' },
  { href: '/production-app/voronezh', label: 'Доставка в Воронеж', icon: '🚚' },
  { href: '/production-app/scan',     label: 'Скан',             icon: '📷' },
  { href: '/production-app/activity', label: 'Кто что делал',    icon: '👥' },
  { href: '/production-app/metrics',  label: 'Метрики цеха',     icon: '📈' },
]

// Материал и документы: ежедневная проверка материала выше, документы реже.
const PRODUCTION_NAV_SUPPLY: NavItem[] = [
  { href: '/production-app/material', label: 'Материал',         icon: '📦' },
  { href: '/inventory',               label: 'Склад — остатки',  icon: '🏬' },
  { href: '/b2b-cutting',             label: 'Раскрой стекла',   icon: '✂️' },
  { href: '/production-app/buy',      label: 'Необходимо купить', icon: '🛒' },
  { href: '/production-app/docs',     label: 'Документы',        icon: '📄' },
]

// Команда: идеи и предложения цеха.
const PRODUCTION_NAV_TEAM: NavItem[] = [
  { href: '/production-app/ideas',    label: 'Идеи и проблемы',  icon: '💡' },
]

// Обучение: регламент. Учебный заказ ДЕМО-1 убран 26.08 — владелец подтвердил,
// что он больше не нужен: цех устоявшийся, новых людей на нём не обучают.
const PRODUCTION_NAV_LEARN: NavItem[] = [
  { href: '/production-app/guide',    label: 'Регламент работы',      icon: '📘' },
]

// Группа «Деньги» цеха. 26.08 её убрали из навигации с доводом «витрина финмодели
// CFO к работе смены не относится». Обращение №4 от цеха (Бекмурза, 28.08) показало,
// что довод неверен: по плану выручки формируется бонус, то есть к работе смены это
// относится напрямую. Экран всё это время был на месте — но только по прямому адресу,
// которого рабочий не знает; для него раздел просто исчез.
// Ссылка возвращается ТОЛЬКО тем, кому владелец выдал право (users.can_view_money):
// доступ никому не расширяется, восстанавливается лишь видимость уже выданного.
const PRODUCTION_NAV_MONEY: NavItem[] = [
  { href: '/production-app/money', label: 'Деньги и план', icon: '💰' },
]

// «Мой заработок» — кабинет партнёра: его клиенты, их оборот и начисление по ставке.
// Ссылки на него не было в меню ВООБЩЕ, и Адилет сказал, что кабинет «пропал»:
// страница жива, ставка 1% на месте, шесть приведённых им клиентов на месте —
// попасть было некуда. Та же болезнь, что у «Денег» цеха.
// Показываем только тем, у кого ставка задана: остальным это пустой экран.
const PRODUCTION_NAV_REFERRAL: NavItem[] = [
  { href: '/production-app/earnings', label: 'Мой заработок', icon: '🤝' },
]

// ─── Path helpers ─────────────────────────────────────────────────────────────

const MGLASS_PATHS = [
  '/calculator/mirror', '/calculator/shower', '/calculator/loft', '/calculator/railing', '/design-scan',
  '/calculations', '/orders', '/clients', '/calendar', '/measurer', '/measure-requests', '/measure-calendar', '/my-earnings',
]
const B2B_PATHS = [
  '/manager-dashboard', '/calculator/b2b', '/b2b-quotes', '/b2b-orders', '/b2b-crm',
  '/b2b-pipeline', '/b2b-production', '/b2b-cutting', '/b2b-analytics',
]

function inSection(pathname: string, paths: string[]): boolean {
  return paths.some(p => pathname === p || pathname.startsWith(p + '/'))
}

function autoOpenAdmin(pathname: string, mode: ViewMode): string[] {
  const open: string[] = []
  if (mode === 'manager') {
    if (inSection(pathname, MGLASS_PATHS)) open.push('mglass')
    if (inSection(pathname, B2B_PATHS))   open.push('b2b')
  } else if (mode === 'production') {
    if (inSection(pathname, ['/production-app', '/b2b-production'])) open.push('prod_shop')
    if (inSection(pathname, ['/b2b-cutting', '/production-app/material', '/production-app/docs', '/production-app/buy'])) open.push('prod_supply')
    if (inSection(pathname, ['/production-app/ideas'])) open.push('prod_team')
    if (inSection(pathname, ['/production-app/guide'])) open.push('prod_learn')
  } else if (mode === 'ceo') {
    if (inSection(pathname, ['/admin/ai-control-center', '/admin/owner', '/admin/dashboard', '/admin/pnl', '/admin/analytics-mglass', '/admin/bonus-center', '/admin/sales-center', '/admin/sales-control', '/admin/b2b-development', '/admin/org', '/admin/users', '/production-app'])) open.push('owner')
    if (inSection(pathname, ['/marketing'])) open.push('marketing')
    if (inSection(pathname, ['/vladislav', '/ai-stats', '/amo-analysis', '/admin/integrations'])) open.push('vladislav')
    if (inSection(pathname, ['/admin/product-line', '/admin/b2b-presentation'])) open.push('productline')
    if (inSection(pathname, ['/admin/pricing-manual', '/admin/owner-questionnaire', '/admin/roadmap', '/admin/infrastructure', '/admin/shower-images'])) open.push('system')
  } else {
    if (inSection(pathname, ['/admin/glass-prices', '/admin/mirror-lighting', '/admin/mirror-frames', '/admin/facet', '/admin/materials', '/admin/services', '/admin/hardware', '/admin/shower-hardware', '/admin/loft-rates', '/admin/mirror-frame-rates', '/admin/railing-rates', '/admin/settings', '/admin/suppliers', '/admin/supplier-catalog', '/admin/procurement'])) open.push('directories')
    if (inSection(pathname, ['/admin/b2b-clients', '/admin/b2b-services', '/admin/b2b-materials', '/admin/ai-b2b-quote'])) open.push('b2b')
    if (inSection(pathname, ['/measure-requests', '/measure-calendar', '/measurer-cabinet', '/admin/installations', '/inventory', '/admin/stock-control', '/admin/route-sheet', '/admin/brigades', '/admin/delivery-zones', '/admin/ideas', '/admin/referrals', '/admin/referral-stats', '/admin/security', '/admin/activity'])) open.push('operations')
  }
  return open
}

function autoOpenRole(pathname: string, role: Role): string[] {
  const open: string[] = []
  if (role === 'cfo') return open
  if (role === 'buyer') {
    if (inSection(pathname, ['/inventory', '/admin/stock-control'])) open.push('buyer_sklad')
    if (inSection(pathname, ['/admin/procurement', '/admin/suppliers', '/admin/supplier-catalog', '/admin/visualizer-pricing', '/admin/shower-hardware', '/admin/hardware'])) open.push('buyer_zakupki')
    if (inSection(pathname, ['/admin/route-sheet', '/orders', '/b2b-orders'])) open.push('buyer_logistika')
    if (inSection(pathname, ['/admin/glass-prices', '/admin/facet', '/admin/mirror-lighting', '/admin/mirror-frames', '/admin/services', '/admin/cutting-settings'])) open.push('buyer_spravochniki')
    if (inSection(pathname, ['/admin/guide'])) open.push('buyer_pomosh')
    if (inSection(pathname, ['/calculator/b2b', '/b2b-quotes', '/b2b-orders', '/b2b-cutting'])) open.push('buyer_b2b_mglass')
    if (inSection(pathname, ['/production-app'])) open.push('buyer_production')
    return open
  }
  if (role === 'production') {
    if (inSection(pathname, ['/production-app', '/b2b-production'])) open.push('prod_shop')
    if (inSection(pathname, ['/b2b-cutting', '/production-app/material', '/production-app/docs', '/production-app/buy'])) open.push('prod_supply')
    if (inSection(pathname, ['/production-app/ideas'])) open.push('prod_team')
    if (inSection(pathname, ['/production-app/guide'])) open.push('prod_learn')
    return open
  }
  if (role === 'manager') {
    if (inSection(pathname, MGLASS_PATHS)) open.push('mglass')
    if (inSection(pathname, B2B_PATHS))   open.push('b2b')
  } else if (role === 'seo') {
    if (inSection(pathname, ['/b2b-analytics', '/ai-stats', '/amo-analysis', '/ai-sales'])) open.push('analytics')
    if (inSection(pathname, ['/marketing'])) open.push('marketing')
    if (inSection(pathname, ['/ai-assistant', '/kp-generator', '/vladislav'])) open.push('ai')
  } else if (role === 'ceo') {
    if (inSection(pathname, ['/admin/ai-control-center', '/admin/owner', '/admin/dashboard', '/admin/pnl', '/admin/analytics-mglass', '/admin/bonus-center', '/admin/sales-center', '/admin/sales-control', '/admin/b2b-development', '/admin/org', '/admin/users', '/production-app'])) open.push('owner')
    if (inSection(pathname, ['/b2b-analytics', '/vladislav', '/marketing', '/ai-stats', '/amo-analysis', '/ai-sales'])) open.push('analytics')
    if (inSection(pathname, ['/admin/pricing-manual', '/admin/owner-questionnaire', '/admin/roadmap'])) open.push('system')
  }
  return open
}

function detectModeFromPath(pathname: string): ViewMode {
  if (pathname.startsWith('/cfo')) return 'cfo'
  if (pathname.startsWith('/measurer-cabinet')) return 'measurer'
  if (
    pathname.startsWith('/b2b-orders') ||
    pathname.startsWith('/production-app') ||
    pathname.startsWith('/b2b-production')
  ) return 'production'
  if (
    pathname.startsWith('/admin/ai-control-center') ||
    pathname.startsWith('/admin/owner') || pathname.startsWith('/admin/dashboard') ||
    pathname.startsWith('/admin/pnl')   || pathname.startsWith('/admin/analytics-mglass') ||
    pathname.startsWith('/admin/bonus-center') || pathname.startsWith('/admin/sales-center') ||
    pathname.startsWith('/admin/sales-control') ||
    pathname.startsWith('/admin/b2b-development') || pathname.startsWith('/admin/org') ||
    pathname.startsWith('/admin/users') || pathname.startsWith('/admin/product-line') ||
    pathname.startsWith('/admin/b2b-presentation') || pathname.startsWith('/admin/roadmap') ||
    pathname.startsWith('/admin/pricing-manual') || pathname.startsWith('/admin/owner-questionnaire') ||
    pathname.startsWith('/admin/infrastructure') || pathname.startsWith('/admin/shower-images') ||
    pathname.startsWith('/marketing') || pathname.startsWith('/vladislav') ||
    pathname.startsWith('/ai-stats')  || pathname.startsWith('/amo-analysis')
  ) return 'ceo'
  if (pathname.startsWith('/admin')) return 'admin'
  return 'manager'
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar({ userEmail, role, permissions = DEFAULT_PERMISSIONS, canViewMoney = false, referralRate = null }: Props) {
  const router   = useRouter()
  const pathname = usePathname()

  const isAdmin = role === 'admin'

  const [viewMode, setViewMode]     = useState<ViewMode>('manager')
  // Закупщик с manager_workspace (Вера): две вкладки — Менеджер / Логист.
  const [buyerWs, setBuyerWs]       = useState<'manager' | 'logist'>('manager')
  const [open, setOpen]             = useState<Set<string>>(new Set())
  const [mobileOpen, setMobileOpen] = useState(false)
  const [syncState, setSyncState]   = useState<SyncState>('idle')
  const [isLocalhost, setIsLocalhost] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLocalhost(window.location.hostname === 'localhost')
    if (isAdmin) {
      const saved = localStorage.getItem('sidebarMode') as ViewMode | null
      const mode: ViewMode = saved ?? detectModeFromPath(pathname)
      setViewMode(mode)
      setOpen(new Set(autoOpenAdmin(pathname, mode)))
    } else if (role) {
      const base = autoOpenRole(pathname, role)
      if (role === 'buyer' && permissions.manager_workspace) {
        const saved = localStorage.getItem('buyerWorkspace')
        const ws = saved === 'logist' ? 'logist' : 'manager'
        setBuyerWs(ws)
        if (ws === 'manager') base.push('mglass', 'b2b')  // менеджерские секции открыты сразу
      }
      setOpen(new Set(base))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isAdmin) {
      const auto = autoOpenAdmin(pathname, viewMode)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (auto.length) setOpen(prev => new Set([...prev, ...auto]))
    } else if (role) {
      const auto = autoOpenRole(pathname, role)
      if (auto.length) setOpen(prev => new Set([...prev, ...auto]))
    }
  }, [pathname, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ранний return строго после всех хуков (rules-of-hooks)
  if (pathname?.endsWith('/print')) return null

  function switchMode(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem('sidebarMode', mode)
    setOpen(new Set(autoOpenAdmin(pathname, mode)))
  }

  function switchBuyerWs(ws: 'manager' | 'logist') {
    setBuyerWs(ws)
    localStorage.setItem('buyerWorkspace', ws)
    if (ws === 'manager') setOpen(prev => new Set([...prev, 'mglass', 'b2b']))
  }

  function toggle(key: string) {
    setOpen(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function logout() {
    await createClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }

  async function handleSync() {
    setSyncState('loading')
    try {
      const res  = await fetch('/api/admin/sync', { method: 'POST' })
      const text = await res.text()
      let data: { ok?: boolean } = {}
      try { data = JSON.parse(text) } catch { /* non-JSON */ }
      setSyncState(data.ok ? 'ok' : 'error')
      if (data.ok) setTimeout(() => setSyncState('idle'), 3000)
    } catch {
      setSyncState('error')
    }
  }

  const active = (href: string) => pathname === href || pathname.startsWith(href + '/')

  // ── Nav item ────────────────────────────────────────────────────────────────

  const navItem = (item: NavItem, activeCls: string) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={() => setMobileOpen(false)}
      className={`flex items-center gap-2 py-[6px] rounded-md text-[13px] transition-colors ${
        item.indent ? 'pl-7 pr-2.5' : 'px-2.5'
      } ${
        active(item.href)
          ? activeCls
          : 'text-[#6b6b66] hover:bg-[#f5f5f3] hover:text-[#111110]'
      }`}
    >
      <span className="text-[13px] w-4 flex-shrink-0 text-center leading-none opacity-75">{item.icon}</span>
      <span className="leading-tight tracking-[-0.01em]">{item.label}</span>
    </Link>
  )

  // ── Small accordion (for non-manager sections) ──────────────────────────────

  const accordion = (
    id: string,
    label: string,
    labelCls: string,
    chevronCls: string,
    entries: NavEntry[],
    activeCls: string,
  ) => {
    const isOpen = open.has(id)
    return (
      <div key={id}>
        <button
          onClick={() => toggle(id)}
          className="w-full flex items-center justify-between px-2.5 py-[6px] rounded-md hover:bg-[#f5f5f3] transition-colors"
        >
          <span className={`text-[10px] font-bold uppercase tracking-widest ${labelCls}`}>{label}</span>
          <svg
            className={`w-3 h-3 ${chevronCls} transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <div className="mt-0.5 space-y-px">
            {entries.map((entry, idx) =>
              isGroup(entry) ? (
                <div key={`group-${idx}`} className="px-2.5 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-[#b8b8b2]">
                  {entry.groupLabel}
                </div>
              ) : (
                navItem(entry, activeCls)
              )
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Top-level workspace accordion (MGlass / B2B) ────────────────────────────

  const workspaceAccordion = (
    id: string,
    label: string,
    dot: string,       // dot color class, e.g. 'bg-[#111110]' or 'bg-orange-500'
    labelCls: string,
    entries: NavEntry[],
    activeCls: string,
  ) => {
    const isOpen = open.has(id)
    return (
      <div key={id} className="mb-1">
        <button
          onClick={() => toggle(id)}
          className="w-full flex items-center justify-between px-2.5 py-[7px] rounded-md hover:bg-[#f5f5f3] transition-colors group"
        >
          <div className="flex items-center gap-2">
            <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${dot}`} />
            <span className={`text-[13px] font-semibold tracking-[-0.01em] ${labelCls}`}>{label}</span>
          </div>
          <svg
            className={`w-3 h-3 text-[#c4c4be] group-hover:text-[#9a9a95] transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <div className="mt-0.5 space-y-px ml-0.5">
            {entries.map((entry, idx) =>
              isGroup(entry) ? (
                <div key={`group-${idx}`} className="px-2.5 pt-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-[#b8b8b2]">
                  {entry.groupLabel}
                </div>
              ) : (
                navItem(entry, activeCls)
              )
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Role-based navigation ───────────────────────────────────────────────────

  function buildMglassNav(): NavEntry[] {
    return MANAGER_MGLASS.filter(e => {
      if (isGroup(e)) return true
      if (e.href === '/clients')     return permissions.see_clients
      if (e.href === '/calendar')    return permissions.see_calendar
      if (e.href === '/my-earnings') return permissions.see_earnings
      return true
    })
  }

  function buildB2bNav(): NavItem[] {
    return MANAGER_B2B
  }

  // Менеджерское пространство: AmoCRM + MGlass (B2C) + B2B. Используется и для
  // роли manager, и как вкладка «Менеджер» у закупщика с manager_workspace (Вера).
  function renderManagerWorkspace() {
    const mglassNav = buildMglassNav()
    const b2bNav    = buildB2bNav()
    return (
      <>
        <div className="space-y-px mb-2">
          {MANAGER_AMO.map(item => navItem(item, 'bg-[#f0f0ec] text-[#111110] font-medium'))}
        </div>
        <div className="my-1 mx-2 h-px bg-[#f0f0ec]" />
        {permissions.see_mglass && workspaceAccordion(
          'mglass', 'MGlass',
          'bg-[#111110]', 'text-[#111110]',
          mglassNav,
          'bg-[#f0f0ec] text-[#111110] font-medium',
        )}
        {permissions.see_mglass && permissions.see_b2b && (
          <div className="my-1 mx-2 h-px bg-[#f0f0ec]" />
        )}
        {permissions.see_b2b && workspaceAccordion(
          'b2b', 'B2B',
          'bg-orange-400', 'text-[#c2600a]',
          b2bNav,
          'bg-[#fff1e8] text-[#c2410c] font-medium',
        )}
      </>
    )
  }

  // Пространство «Логист / Закупщик»: текущий контур закупщика (B2B по скоупу,
  // склад, закупки, логистика, справочники, производство).
  function renderBuyerLogist() {
    const showB2B = hasB2BSalesScope(permissions)
    const b2bAll = isAllClientsScope(permissions)
    return (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-emerald-600">Логист / Закупщик</div>
        {showB2B && accordion(
          'buyer_b2b',
          b2bAll ? 'B2B' : 'B2B M GLASS',
          'text-orange-600',
          'text-orange-400',
          b2bAll ? BUYER_B2B_ALL : BUYER_B2B_MGLASS,
          'bg-[#fff1e8] text-[#c2410c] font-medium',
        )}
        {accordion('buyer_sklad',        'Склад',        'text-emerald-600', 'text-emerald-400', BUYER_SKLAD,        'bg-emerald-50 text-emerald-700 font-medium')}
        {accordion('buyer_zakupki',      'Закупки',      'text-emerald-600', 'text-emerald-400', BUYER_ZAKUPKI,      'bg-emerald-50 text-emerald-700 font-medium')}
        {accordion('buyer_logistika',    'Логистика',    'text-emerald-600', 'text-emerald-400', BUYER_LOGISTIKA,    'bg-emerald-50 text-emerald-700 font-medium')}
        {accordion('buyer_spravochniki', 'Справочники',  'text-emerald-600', 'text-emerald-400', BUYER_SPRAVOCHNIKI, 'bg-emerald-50 text-emerald-700 font-medium')}
        {accordion('buyer_pomosh',       'Помощь',       'text-emerald-600', 'text-emerald-400', BUYER_POMOSH,       'bg-emerald-50 text-emerald-700 font-medium')}
        {showB2B && accordion(
          'buyer_production',
          'Производство',
          'text-orange-600',
          'text-orange-400',
          BUYER_PRODUCTION,
          'bg-[#fff1e8] text-[#c2410c] font-medium',
        )}
      </>
    )
  }

  function renderNav() {
    // Бухгалтерия: только свой раздел
    if (role === 'accountant') return (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-teal-600">Бухгалтерия</div>
        <div className="space-y-px">
          {navItem({ href: '/accounting', label: 'ДДС и операции', icon: '🧾' }, 'bg-teal-50 text-teal-700 font-medium')}
        </div>
      </>
    )

    // Замерщик: только свой кабинет
    if (role === 'measurer') return (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-indigo-600">Замеры</div>
        <div className="space-y-px">
          {navItem({ href: '/measurer-cabinet', label: 'Кабинет замерщика', icon: '📏' }, 'bg-indigo-50 text-indigo-700 font-medium')}
          {navItem({ href: '/measure-calendar', label: 'Календарь замеров', icon: '🗓️' }, 'bg-indigo-50 text-indigo-700 font-medium')}
        </div>
      </>
    )

    // Manager: MGlass + B2B (filtered by permissions)
    if (role === 'cfo') return (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-teal-600">CFO Center</div>
        <div className="space-y-px">
          {CFO_ITEMS.map(item => navItem(item, 'bg-teal-50 text-teal-700 font-medium'))}
        </div>
      </>
    )

    if (role === 'commercial') return (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-indigo-600">Коммерческий</div>
        <div className="space-y-px">
          {navItem({ href: '/commercial', label: 'Аналитика менеджеров', icon: '📈' }, 'bg-indigo-50 text-indigo-700 font-medium')}
          {navItem({ href: '/commercial/churn', label: 'Отток клиентов',  icon: '📉' }, 'bg-indigo-50 text-indigo-700 font-medium')}
          {navItem({ href: '/sales',      label: 'Отдел продаж',         icon: '💰' }, 'bg-indigo-50 text-indigo-700 font-medium')}
          {navItem({ href: '/ceo',        label: 'CEO Обзор',            icon: '👑' }, 'bg-indigo-50 text-indigo-700 font-medium')}
        </div>
      </>
    )

    if (role === 'manager') return renderManagerWorkspace()

    // Buyer: аккордеон-секции. Если у buyer есть B2B-скоуп, дополнительно
    // показываем группу B2B: mglass_only — внутренний M GLASS-контур,
    // all_clients (Вера) — полный B2B со списком клиентов. B2B ставим ПЕРВОЙ,
    // чтобы это была явная отдельная вкладка, как просил владелец.
    if (role === 'buyer') {
      // Без manager_workspace — обычный закупщик, только его контур.
      if (!permissions.manager_workspace) return renderBuyerLogist()
      // Вера: две вкладки — Менеджер (слева) / Логист (справа).
      return (
        <>
          <div className="flex bg-[#efefec] rounded-[7px] p-[3px] gap-[2px] mb-2">
            {([['manager', 'Менеджер'], ['logist', 'Логист']] as const).map(([v, l]) => (
              <button key={v} onClick={() => switchBuyerWs(v)}
                className={`flex-1 py-[5px] rounded-[5px] text-[11px] font-semibold transition-all ${
                  buyerWs === v ? 'bg-white text-[#111110] shadow-sm' : 'text-[#9a9a95] hover:text-[#6b6b66]'
                }`}>
                {l}
              </button>
            ))}
          </div>
          {buyerWs === 'manager' ? renderManagerWorkspace() : renderBuyerLogist()}
        </>
      )
    }

    // Production: flat list
    if (role === 'production') return (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-orange-500">Производство</div>
        {accordion('prod_shop',   'Цех',                  'text-orange-600', 'text-orange-400', PRODUCTION_NAV_SHOP,   'bg-[#fff1e8] text-[#c2410c] font-medium')}
        {accordion('prod_supply', 'Материал и документы', 'text-orange-600', 'text-orange-400', PRODUCTION_NAV_SUPPLY, 'bg-[#fff1e8] text-[#c2410c] font-medium')}
        {accordion('prod_team',   'Команда',              'text-emerald-600', 'text-emerald-400', PRODUCTION_NAV_TEAM, 'bg-emerald-50 text-emerald-700 font-medium')}
        {accordion('prod_learn',  'Обучение',             'text-blue-600',   'text-blue-400',   PRODUCTION_NAV_LEARN,  'bg-blue-50 text-blue-700 font-medium')}
        {canViewMoney && accordion('prod_money', 'Деньги', 'text-emerald-700', 'text-emerald-500', PRODUCTION_NAV_MONEY, 'bg-emerald-50 text-emerald-800 font-medium')}
        {referralRate != null && accordion('prod_ref', 'Партнёрство', 'text-violet-700', 'text-violet-500', PRODUCTION_NAV_REFERRAL, 'bg-violet-50 text-violet-800 font-medium')}
      </>
    )

    // SEO: analytics + marketing + AI
    if (role === 'seo') return (
      <>
        {accordion('analytics', 'Аналитика',      'text-blue-600',   'text-blue-400',   SEO_ANALYTICS, 'bg-blue-50 text-blue-700 font-medium')}
        {accordion('marketing', 'Маркетинг',       'text-rose-600',   'text-rose-400',   SEO_MARKETING, 'bg-rose-50 text-rose-700 font-medium')}
        {accordion('ai',        'AI Инструменты',  'text-violet-600', 'text-violet-400', SEO_AI,        'bg-violet-50 text-violet-700 font-medium')}
      </>
    )

    // CEO
    if (role === 'ceo') return (
      <>
        {accordion('owner',     'Owner Center', 'text-purple-600', 'text-purple-400', CEO_OWNER,     'bg-purple-50 text-purple-700 font-medium')}
        {accordion('analytics', 'Аналитика',    'text-blue-600',   'text-blue-400',   CEO_ANALYTICS, 'bg-blue-50 text-blue-700 font-medium')}
        {accordion('system',    'Система',      'text-[#6b6b66]',  'text-[#c4c4be]',  CEO_SYSTEM,    'bg-[#f5f5f3] text-[#111110] font-medium')}
      </>
    )

    // Admin preview — manager view (shows everything, ignores permissions for admin)
    if (viewMode === 'manager') return (
      <>
        {workspaceAccordion(
          'mglass', 'MGlass',
          'bg-[#111110]', 'text-[#111110]',
          MANAGER_MGLASS,
          'bg-[#f0f0ec] text-[#111110] font-medium',
        )}
        <div className="my-1 mx-2 h-px bg-[#f0f0ec]" />
        {workspaceAccordion(
          'b2b', 'B2B',
          'bg-orange-400', 'text-[#c2600a]',
          MANAGER_B2B,
          'bg-[#fff1e8] text-[#c2410c] font-medium',
        )}
      </>
    )

    if (viewMode === 'cfo') return (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-teal-600">CFO Center</div>
        <div className="space-y-px">
          {CFO_ITEMS.map(item => navItem(item, 'bg-teal-50 text-teal-700 font-medium'))}
        </div>
      </>
    )

    if (viewMode === 'ceo') return (
      <>
        {accordion('owner',       'Owner Center', 'text-purple-600', 'text-purple-400', ADMIN_OWNER,        'bg-purple-50 text-purple-700 font-medium')}
        {accordion('marketing',   'Маркетинг',    'text-rose-600',   'text-rose-400',   ADMIN_MARKETING,    'bg-rose-50 text-rose-700 font-medium')}
        {accordion('vladislav',   'Vladislav AI', 'text-indigo-600', 'text-indigo-400', ADMIN_VLADISLAV,    'bg-indigo-50 text-indigo-700 font-medium')}
        {accordion('productline', 'Product Line', 'text-violet-600', 'text-violet-400', ADMIN_PRODUCT_LINE, 'bg-violet-50 text-violet-700 font-medium')}
        {accordion('system',      'Система',      'text-[#6b6b66]',  'text-[#c4c4be]',  ADMIN_SYSTEM,       'bg-[#f5f5f3] text-[#111110] font-medium')}
      </>
    )

    if (viewMode === 'measurer') return (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-cyan-600">Замеры</div>
        <div className="space-y-px">
          {navItem({ href: '/measurer-cabinet', label: 'Кабинет замерщика', icon: '📏' }, 'bg-cyan-50 text-cyan-700 font-medium')}
          {navItem({ href: '/measure-requests', label: 'Заявки на замер',   icon: '📐' }, 'bg-cyan-50 text-cyan-700 font-medium')}
          {navItem({ href: '/measure-calendar', label: 'Календарь замеров', icon: '🗓️' }, 'bg-cyan-50 text-cyan-700 font-medium')}
        </div>
      </>
    )

    if (viewMode === 'production') return (
      <>
        <div className="px-2.5 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-widest text-orange-600">Производство</div>
        {accordion('prod_shop',   'Цех',                  'text-orange-600', 'text-orange-400', PRODUCTION_NAV_SHOP,   'bg-[#fff1e8] text-[#c2410c] font-medium')}
        {accordion('prod_supply', 'Материал и документы', 'text-orange-600', 'text-orange-400', PRODUCTION_NAV_SUPPLY, 'bg-[#fff1e8] text-[#c2410c] font-medium')}
        {accordion('prod_team',   'Команда',              'text-emerald-600', 'text-emerald-400', PRODUCTION_NAV_TEAM, 'bg-emerald-50 text-emerald-700 font-medium')}
        {accordion('prod_learn',  'Обучение',             'text-blue-600',   'text-blue-400',   PRODUCTION_NAV_LEARN,  'bg-blue-50 text-blue-700 font-medium')}
        {canViewMoney && accordion('prod_money', 'Деньги', 'text-emerald-700', 'text-emerald-500', PRODUCTION_NAV_MONEY, 'bg-emerald-50 text-emerald-800 font-medium')}
        {referralRate != null && accordion('prod_ref', 'Партнёрство', 'text-violet-700', 'text-violet-500', PRODUCTION_NAV_REFERRAL, 'bg-violet-50 text-violet-800 font-medium')}
      </>
    )

    // Admin directories view
    return (
      <>
        {accordion('directories', 'Справочники', 'text-[#6b6b66]', 'text-[#c4c4be]', ADMIN_DIRECTORIES, 'bg-[#f5f5f3] text-[#111110] font-medium')}
        {accordion('b2b',         'B2B',         'text-[#6b6b66]', 'text-[#c4c4be]', ADMIN_B2B,         'bg-[#f5f5f3] text-[#111110] font-medium')}
        {accordion('operations',  'Операции',    'text-[#6b6b66]', 'text-[#c4c4be]', ADMIN_OPERATIONS,  'bg-[#f5f5f3] text-[#111110] font-medium')}
      </>
    )
  }

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/25 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <button
        aria-label="Открыть меню"
        onClick={() => setMobileOpen(v => !v)}
        className="fixed top-3.5 left-3.5 z-50 lg:hidden w-8 h-8 flex items-center justify-center bg-white border border-[#e4e4e0] rounded-lg shadow-sm"
      >
        <svg className="w-4 h-4 text-[#4b4b47]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {mobileOpen
            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}   d="M4 6h16M4 12h16M4 18h16" />
          }
        </svg>
      </button>

      <aside
        className={`
          fixed lg:sticky top-0 left-0 h-screen z-40 lg:z-auto
          w-[250px] flex-shrink-0 flex flex-col bg-[#fbfbfd] border-r border-[#ececf0]
          transition-transform duration-200 ease-in-out overflow-hidden
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="border-b border-[#ebebе8] flex-shrink-0">
          <Link href="/" onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3 hover:bg-[#f5f5f3] transition-colors">
            <div className="w-[26px] h-[26px] bg-[#111110] rounded-[6px] flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[10px] font-bold tracking-tight">MG</span>
            </div>
            <div>
              <span className="text-[14px] font-bold text-[#111110] tracking-[-0.02em]">MGlass</span>
              {!isAdmin && role && (
                <div className="text-[10px] text-[#b0b0aa] leading-tight">
                  {role === 'manager' ? 'Менеджер' : role === 'production' ? 'Производство' : role === 'seo' ? 'SEO' : role === 'cfo' ? 'CFO' : role === 'commercial' ? 'Коммерческий' : 'CEO'}
                </div>
              )}
            </div>
          </Link>

          {isAdmin && (
            <div className="px-3 pb-3 space-y-[4px]">
              {/* Два ряда: сверху — владельческие режимы, снизу — операционные */}
              {([
                [
                  { v: 'ceo',        l: 'СЕО'      },
                  { v: 'cfo',        l: 'CFO'      },
                  { v: 'admin',      l: 'Админ'    },
                ],
                [
                  { v: 'manager',    l: 'Менеджер' },
                  { v: 'production', l: 'Произв.'  },
                  { v: 'measurer',   l: 'Замерщик' },
                ],
              ] as { v: ViewMode; l: string }[][]).map((row, ri) => (
                <div key={ri} className="flex bg-[#efefec] rounded-[7px] p-[3px] gap-[2px]">
                  {row.map(({ v, l }) => (
                    <button key={v} onClick={() => switchMode(v)}
                      className={`flex-1 py-[4px] rounded-[5px] text-[10px] font-semibold transition-all ${
                        viewMode === v
                          ? 'bg-white text-[#111110] shadow-sm'
                          : 'text-[#9a9a95] hover:text-[#6b6b66]'
                      }`}>
                      {l}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {isLocalhost && isAdmin && (
            <div className="px-3 pb-3">
              <button onClick={handleSync} disabled={syncState === 'loading'}
                className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-semibold transition-all disabled:opacity-50 ${
                  syncState === 'ok'    ? 'bg-emerald-100 text-emerald-700' :
                  syncState === 'error' ? 'bg-red-50 text-red-600' :
                  'bg-[#efefec] text-[#6b6b66] hover:bg-[#e8e8e4] hover:text-[#111110]'
                }`}>
                {syncState === 'loading' ? '...' :
                 syncState === 'ok'      ? '✓ Синхронизировано' :
                 syncState === 'error'   ? 'Ошибка' : '↻ Синхронизировать'}
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-2 space-y-px overflow-y-auto">
          {/* Личная вкладка владельца — всегда сверху, во всех режимах */}
          {userEmail === 'admin@mglass.ru' && (
            <div className="mb-2">
              {navItem({ href: '/vlad', label: 'Влад', icon: '🔒' }, 'bg-[#111110] text-white font-medium')}
            </div>
          )}
          {renderNav()}
        </nav>

        {/* Footer */}
        <div className="px-3 py-2.5 border-t border-[#ebebе8] flex-shrink-0">
          <div className="flex items-center gap-2 px-2 mb-1">
            <div className="w-5 h-5 rounded-full bg-[#efefec] border border-[#e4e4e0] flex items-center justify-center flex-shrink-0">
              <span className="text-[9px] font-bold text-[#6b6b66]">{(userEmail[0] ?? '?').toUpperCase()}</span>
            </div>
            <p className="text-[11px] text-[#9a9a95] truncate leading-tight">{userEmail}</p>
          </div>
          <button onClick={logout}
            className="w-full text-left px-2 py-1.5 rounded-md text-[12px] text-[#b0b0aa] hover:text-red-500 hover:bg-red-50 transition-colors">
            Выйти
          </button>
        </div>

      </aside>
    </>
  )
}
