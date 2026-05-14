'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import type { Role } from '@/lib/getRole'

type Props = { userEmail: string; role: Role | null }
type SyncState = 'idle' | 'loading' | 'ok' | 'error'
type ViewMode = 'manager' | 'admin' | 'ceo'

type NavItem  = { href: string; label: string; icon: string; indent?: boolean }
type NavGroup = { groupLabel: string }
type NavEntry = NavItem | NavGroup

function isGroup(e: NavEntry): e is NavGroup { return 'groupLabel' in e }

// ─── Manager role ─────────────────────────────────────────────────────────────

const MANAGER_B2C_CALC: NavItem[] = [
  { href: '/calculator/mirror', label: 'Зеркало',          icon: '🪞' },
  { href: '/calculator/shower', label: 'Душевая',          icon: '🚿' },
  { href: '/calculator/loft',   label: 'Лофт-перегородка', icon: '🏗️' },
]

const MANAGER_B2C_SALES: NavItem[] = [
  { href: '/calculations', label: 'История расчётов', icon: '📋' },
  { href: '/orders',       label: 'Заказы',           icon: '📦' },
  { href: '/clients',      label: 'Клиенты',          icon: '👤' },
  { href: '/calendar',     label: 'Календарь',        icon: '📅' },
  { href: '/measurer',     label: 'Форма замера',      icon: '📐' },
]

const MANAGER_B2B: NavItem[] = [
  { href: '/manager-dashboard', label: 'Дашборд менеджера', icon: '🎯' },
  { href: '/calculator/b2b',    label: 'B2B Калькулятор',   icon: '🏭' },
  { href: '/b2b-quotes',        label: 'B2B Просчёты',      icon: '📝' },
  { href: '/b2b-orders',        label: 'B2B Заказы',        icon: '📦' },
  { href: '/b2b-crm',           label: 'B2B Клиенты',       icon: '🏢' },
]

// ─── Production role ──────────────────────────────────────────────────────────

const PRODUCTION_ITEMS: NavItem[] = [
  { href: '/manager-dashboard', label: 'Дашборд менеджера', icon: '🎯' },
  { href: '/b2b-pipeline',      label: 'Воронка продаж',    icon: '📌' },
  { href: '/b2b-production',    label: 'Производство B2B',  icon: '🔧' },
  { href: '/production',        label: 'Производство',      icon: '⚙️' },
  { href: '/b2b-orders',        label: 'B2B Заказы',        icon: '📦' },
]

// ─── SEO role ─────────────────────────────────────────────────────────────────

const SEO_ANALYTICS: NavItem[] = [
  { href: '/b2b-analytics', label: 'B2B Аналитика', icon: '📊' },
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
  { href: '/ai-assistant', label: 'AI Ассистент', icon: '🤖' },
  { href: '/kp-generator', label: 'КП Генератор', icon: '📄' },
  { href: '/vladislav',    label: 'Vladislav AI', icon: '💬' },
]

// ─── CEO role ─────────────────────────────────────────────────────────────────

const CEO_OWNER: NavItem[] = [
  { href: '/admin/owner',            label: 'Owner Center',    icon: '👑' },
  { href: '/admin/dashboard',        label: 'Дашборд',         icon: '📊' },
  { href: '/admin/pnl',              label: 'P&L отчёт',       icon: '📈' },
  { href: '/admin/analytics-mglass', label: 'Аналитика',       icon: '🔍' },
  { href: '/admin/bonus-center',     label: 'Bonus Center',    icon: '🎁' },
  { href: '/admin/sales-center',     label: 'Sales Center',    icon: '📣' },
  { href: '/admin/b2b-development',  label: 'B2B Development', icon: '🤝' },
  { href: '/admin/org',              label: 'Оргструктура',    icon: '🏗️' },
  { href: '/admin/users',            label: 'Пользователи',    icon: '👥' },
]

const CEO_ANALYTICS: NavItem[] = [
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
]

// ─── Admin mode: CEO view ─────────────────────────────────────────────────────

const ADMIN_OWNER: NavItem[] = [
  { href: '/admin/owner',            label: 'Owner Center',    icon: '👑' },
  { href: '/admin/dashboard',        label: 'Дашборд',         icon: '📊' },
  { href: '/admin/pnl',              label: 'P&L отчёт',       icon: '📈' },
  { href: '/admin/analytics-mglass', label: 'Аналитика',       icon: '🔍' },
  { href: '/admin/bonus-center',     label: 'Bonus Center',    icon: '🎁' },
  { href: '/admin/sales-center',     label: 'Sales Center',    icon: '📣' },
  { href: '/admin/b2b-development',  label: 'B2B Development', icon: '🤝' },
  { href: '/admin/org',              label: 'Оргструктура',    icon: '🏗️' },
  { href: '/admin/users',            label: 'Пользователи',    icon: '👥' },
]

const ADMIN_MARKETING: NavItem[] = [
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
  { href: '/vladislav',               label: 'Сообщения',           icon: '💬' },
  { href: '/vladislav/calls',         label: 'Анализ звонков',      icon: '📞' },
  { href: '/ai-stats',                label: 'Статистика бота',     icon: '📊' },
  { href: '/vladislav/manager-stats', label: 'Аналитика менеджеров', icon: '👥' },
  { href: '/amo-analysis',            label: 'Воронка AMO',         icon: '🔍' },
  { href: '/vladislav/tasks',         label: 'Задачи AI',           icon: '🗂️' },
  { href: '/admin/integrations',      label: 'Avito / AMO Monitor', icon: '🔗' },
]

const ADMIN_PRODUCT_LINE: NavItem[] = [
  { href: '/admin/product-line',         label: 'Продуктовая линейка', icon: '📦' },
  { href: '/admin/product-line/catalog', label: 'Каталог серий',       icon: '🪞' },
  { href: '/admin/b2b-presentation',     label: 'B2B Презентация',     icon: '🎯' },
]

const ADMIN_SYSTEM: NavItem[] = [
  { href: '/admin/pricing-manual',      label: 'Pricing Manual', icon: '📖' },
  { href: '/admin/owner-questionnaire', label: 'Стратегия',      icon: '🎯' },
  { href: '/admin/roadmap',             label: 'Roadmap',        icon: '🗺️' },
  { href: '/admin/infrastructure',      label: 'Техцентр',       icon: '⚙️' },
  { href: '/admin/shower-images',       label: 'Media Library',  icon: '🖼️' },
]

// ─── Admin mode: Admin view ───────────────────────────────────────────────────

const ADMIN_DIRECTORIES: NavEntry[] = [
  { href: '/admin/glass-prices',    label: 'Стекло',         icon: '🔷' },
  { href: '/admin/services',        label: 'Услуги',         icon: '🔧' },
  { groupLabel: 'Фурнитура' },
  { href: '/admin/hardware',        label: 'Лофт',           icon: '🔩', indent: true },
  { href: '/admin/shower-hardware', label: 'Душевые',        icon: '🚿', indent: true },
  { href: '/admin/settings',        label: 'Фин. настройки', icon: '💰' },
  { href: '/admin/suppliers',       label: 'Поставщики',     icon: '🏭' },
  { href: '/admin/architecture',    label: 'Карта данных',   icon: '🗺️' },
]

const ADMIN_B2B: NavEntry[] = [
  { href: '/admin/b2b-clients',   label: 'Клиенты',   icon: '🏢' },
  { href: '/admin/b2b-services',  label: 'Услуги',    icon: '🔧' },
  { href: '/admin/b2b-materials', label: 'Материалы', icon: '🪟' },
]

const ADMIN_OPERATIONS: NavItem[] = [
  { href: '/admin/warehouse',      label: 'Склад',           icon: '📦' },
  { href: '/admin/route-sheet',    label: 'Маршрутный лист', icon: '🚚' },
  { href: '/admin/brigades',       label: 'Бригады',         icon: '👷' },
  { href: '/admin/delivery-zones', label: 'Зоны доставки',   icon: '🚗' },
]

// ─── Path helpers ─────────────────────────────────────────────────────────────

function inSection(pathname: string, paths: string[]): boolean {
  return paths.some(p => pathname === p || pathname.startsWith(p + '/'))
}

function autoOpenAdmin(pathname: string, mode: ViewMode): string[] {
  const open: string[] = []
  if (mode === 'manager') {
    if (inSection(pathname, ['/my-earnings'])) open.push('earnings')
    if (inSection(pathname, ['/calculator/mirror', '/calculator/shower', '/calculator/loft'])) open.push('calculator')
    if (inSection(pathname, ['/calculations', '/orders', '/clients', '/calendar', '/measurer'])) open.push('sales')
    if (inSection(pathname, ['/manager-dashboard', '/b2b-crm', '/calculator/b2b', '/b2b-quotes', '/b2b-orders', '/b2b-pipeline', '/b2b-production', '/production', '/b2b-analytics'])) open.push('b2b')
    if (inSection(pathname, ['/ai-assistant', '/kp-generator', '/objections', '/product-finder', '/deal-analysis', '/templates', '/competitors'])) open.push('ai')
  } else if (mode === 'ceo') {
    if (inSection(pathname, ['/admin/owner', '/admin/dashboard', '/admin/pnl', '/admin/analytics-mglass', '/admin/bonus-center', '/admin/sales-center', '/admin/b2b-development', '/admin/org', '/admin/users'])) open.push('owner')
    if (inSection(pathname, ['/marketing'])) open.push('marketing')
    if (inSection(pathname, ['/vladislav', '/ai-stats', '/amo-analysis', '/admin/integrations'])) open.push('vladislav')
    if (inSection(pathname, ['/admin/product-line', '/admin/b2b-presentation'])) open.push('productline')
    if (inSection(pathname, ['/admin/pricing-manual', '/admin/owner-questionnaire', '/admin/roadmap', '/admin/infrastructure', '/admin/shower-images'])) open.push('system')
  } else {
    if (inSection(pathname, ['/admin/glass-prices', '/admin/services', '/admin/hardware', '/admin/shower-hardware', '/admin/settings', '/admin/suppliers', '/admin/architecture'])) open.push('directories')
    if (inSection(pathname, ['/admin/b2b-clients', '/admin/b2b-services', '/admin/b2b-materials'])) open.push('b2b')
    if (inSection(pathname, ['/admin/warehouse', '/admin/route-sheet', '/admin/brigades', '/admin/delivery-zones'])) open.push('operations')
  }
  return open
}

function autoOpenRole(pathname: string, role: Role): string[] {
  const open: string[] = []
  if (role === 'manager') {
    if (inSection(pathname, ['/calculator/mirror', '/calculator/shower', '/calculator/loft'])) open.push('calculator')
    if (inSection(pathname, ['/calculations', '/orders', '/clients', '/calendar', '/measurer'])) open.push('sales')
    if (inSection(pathname, ['/manager-dashboard', '/calculator/b2b', '/b2b-quotes', '/b2b-orders', '/b2b-crm'])) open.push('b2b')
  } else if (role === 'seo') {
    if (inSection(pathname, ['/b2b-analytics', '/ai-stats', '/amo-analysis', '/ai-sales'])) open.push('analytics')
    if (inSection(pathname, ['/marketing'])) open.push('marketing')
    if (inSection(pathname, ['/ai-assistant', '/kp-generator', '/vladislav'])) open.push('ai')
  } else if (role === 'ceo') {
    if (inSection(pathname, ['/admin/owner', '/admin/dashboard', '/admin/pnl', '/admin/analytics-mglass', '/admin/bonus-center', '/admin/sales-center', '/admin/b2b-development', '/admin/org', '/admin/users'])) open.push('owner')
    if (inSection(pathname, ['/b2b-analytics', '/vladislav', '/marketing', '/ai-stats', '/amo-analysis', '/ai-sales'])) open.push('analytics')
    if (inSection(pathname, ['/admin/pricing-manual', '/admin/owner-questionnaire', '/admin/roadmap'])) open.push('system')
  }
  return open
}

function detectModeFromPath(pathname: string): ViewMode {
  if (
    pathname.startsWith('/admin/owner') || pathname.startsWith('/admin/dashboard') ||
    pathname.startsWith('/admin/pnl')   || pathname.startsWith('/admin/analytics-mglass') ||
    pathname.startsWith('/admin/bonus-center') || pathname.startsWith('/admin/sales-center') ||
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

export function Sidebar({ userEmail, role }: Props) {
  const router   = useRouter()
  const pathname = usePathname()

  if (pathname?.endsWith('/print')) return null

  const isAdmin = role === 'admin'

  const [viewMode, setViewMode]     = useState<ViewMode>('manager')
  const [open, setOpen]             = useState<Set<string>>(new Set())
  const [mobileOpen, setMobileOpen] = useState(false)
  const [syncState, setSyncState]   = useState<SyncState>('idle')
  const [isLocalhost, setIsLocalhost] = useState(false)

  useEffect(() => {
    setIsLocalhost(window.location.hostname === 'localhost')
    if (isAdmin) {
      const saved = localStorage.getItem('sidebarMode') as ViewMode | null
      const mode: ViewMode = saved ?? detectModeFromPath(pathname)
      setViewMode(mode)
      setOpen(new Set(autoOpenAdmin(pathname, mode)))
    } else if (role) {
      setOpen(new Set(autoOpenRole(pathname, role)))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isAdmin) {
      const auto = autoOpenAdmin(pathname, viewMode)
      if (auto.length) setOpen(prev => new Set([...prev, ...auto]))
    } else if (role) {
      const auto = autoOpenRole(pathname, role)
      if (auto.length) setOpen(prev => new Set([...prev, ...auto]))
    }
  }, [pathname, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  function switchMode(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem('sidebarMode', mode)
    setOpen(new Set(autoOpenAdmin(pathname, mode)))
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

  // ── Render helpers ──────────────────────────────────────────────────────────

  const navItem = (item: NavItem, activeCls: string) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={() => setMobileOpen(false)}
      className={`flex items-center gap-2.5 py-[7px] rounded-lg text-[13px] transition-colors ${
        item.indent ? 'pl-6 pr-2.5' : 'px-2.5'
      } ${
        active(item.href)
          ? activeCls
          : 'text-[#6b6b66] hover:bg-[#f5f5f3] hover:text-[#111110]'
      }`}
    >
      <span className="text-[14px] w-5 flex-shrink-0 text-center leading-none">{item.icon}</span>
      <span className="leading-tight">{item.label}</span>
    </Link>
  )

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
          className="w-full flex items-center justify-between px-2.5 py-[7px] rounded-lg hover:bg-[#f5f5f3] transition-colors group"
        >
          <span className={`text-[10px] font-bold uppercase tracking-widest ${labelCls}`}>{label}</span>
          <svg
            className={`w-3.5 h-3.5 ${chevronCls} transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <div className="mt-0.5 space-y-0.5 ml-0.5">
            {entries.map((entry, idx) =>
              isGroup(entry) ? (
                <div key={`group-${idx}`} className="px-2.5 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-widest text-[#b0b0aa]">
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

  function renderNav() {
    // Manager: B2C + B2B
    if (role === 'manager') return (
      <>
        {accordion('calculator', 'Калькулятор', 'text-blue-600',   'text-blue-400',   MANAGER_B2C_CALC,  'bg-blue-50 text-blue-700 font-semibold')}
        {accordion('sales',      'Продажи',     'text-blue-600',   'text-blue-400',   MANAGER_B2C_SALES, 'bg-blue-50 text-blue-700 font-semibold')}
        {accordion('b2b',        'B2B',         'text-orange-600', 'text-orange-400', MANAGER_B2B,       'bg-orange-50 text-orange-700 font-semibold')}
      </>
    )

    // Production: flat list
    if (role === 'production') return (
      <div>
        <div className="px-2.5 pt-2 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-orange-500">Производство</div>
        <div className="space-y-0.5">
          {PRODUCTION_ITEMS.map(item => navItem(item, 'bg-orange-50 text-orange-700 font-semibold'))}
        </div>
      </div>
    )

    // SEO: analytics + marketing + AI accordions
    if (role === 'seo') return (
      <>
        {accordion('analytics', 'Аналитика',     'text-blue-600',   'text-blue-400',   SEO_ANALYTICS, 'bg-blue-50 text-blue-700 font-semibold')}
        {accordion('marketing', 'Маркетинг',     'text-rose-600',   'text-rose-400',   SEO_MARKETING, 'bg-rose-50 text-rose-700 font-semibold')}
        {accordion('ai',        'AI Инструменты','text-violet-600', 'text-violet-400', SEO_AI,        'bg-violet-50 text-violet-700 font-semibold')}
      </>
    )

    // CEO: owner + analytics + system
    if (role === 'ceo') return (
      <>
        {accordion('owner',     'Owner Center', 'text-purple-600', 'text-purple-400', CEO_OWNER,     'bg-purple-50 text-purple-700 font-semibold')}
        {accordion('analytics', 'Аналитика',    'text-blue-600',   'text-blue-400',   CEO_ANALYTICS, 'bg-blue-50 text-blue-700 font-semibold')}
        {accordion('system',    'Система',      'text-[#6b6b66]',  'text-[#9a9a95]',  CEO_SYSTEM,    'bg-[#f5f5f3] text-[#111110] font-semibold')}
      </>
    )

    // Admin manager-preview: same view a real manager sees
    if (viewMode === 'manager') return (
      <>
        {accordion('calculator', 'Калькулятор', 'text-blue-600',   'text-blue-400',   MANAGER_B2C_CALC,  'bg-blue-50 text-blue-700 font-semibold')}
        {accordion('sales',      'Продажи',     'text-blue-600',   'text-blue-400',   MANAGER_B2C_SALES, 'bg-blue-50 text-blue-700 font-semibold')}
        {accordion('b2b',        'B2B',         'text-orange-600', 'text-orange-400', MANAGER_B2B,       'bg-orange-50 text-orange-700 font-semibold')}
      </>
    )

    if (viewMode === 'ceo') return (
      <>
        {accordion('owner',       'Owner Center', 'text-purple-600', 'text-purple-400', ADMIN_OWNER,        'bg-purple-50 text-purple-700 font-semibold')}
        {accordion('marketing',   'Маркетинг',    'text-rose-600',   'text-rose-400',   ADMIN_MARKETING,    'bg-rose-50 text-rose-700 font-semibold')}
        {accordion('vladislav',   'Vladislav AI', 'text-indigo-600', 'text-indigo-400', ADMIN_VLADISLAV,    'bg-indigo-50 text-indigo-700 font-semibold')}
        {accordion('productline', 'Product Line', 'text-violet-600', 'text-violet-400', ADMIN_PRODUCT_LINE, 'bg-violet-50 text-violet-700 font-semibold')}
        {accordion('system',      'Система',      'text-[#6b6b66]',  'text-[#9a9a95]',  ADMIN_SYSTEM,       'bg-[#f5f5f3] text-[#111110] font-semibold')}
      </>
    )

    // admin view
    return (
      <>
        {accordion('directories', 'Справочники', 'text-[#6b6b66]', 'text-[#9a9a95]', ADMIN_DIRECTORIES, 'bg-[#f5f5f3] text-[#111110] font-semibold')}
        {accordion('b2b',         'B2B',         'text-[#6b6b66]', 'text-[#9a9a95]', ADMIN_B2B,         'bg-[#f5f5f3] text-[#111110] font-semibold')}
        {accordion('operations',  'Операции',    'text-[#6b6b66]', 'text-[#9a9a95]', ADMIN_OPERATIONS,  'bg-[#f5f5f3] text-[#111110] font-semibold')}
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
          w-56 flex-shrink-0 flex flex-col bg-white border-r border-[#e4e4e0]
          transition-transform duration-200 ease-in-out overflow-hidden
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="border-b border-[#e4e4e0] flex-shrink-0">
          <Link href="/" onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3.5 hover:bg-[#fafaf9] transition-colors">
            <div className="w-7 h-7 bg-[#111110] rounded-[6px] flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[11px] font-bold tracking-tight">MG</span>
            </div>
            <div>
              <span className="text-[15px] font-bold text-[#111110] tracking-tight">MGlass</span>
              {!isAdmin && role && (
                <div className="text-[10px] text-[#9a9a95] leading-tight capitalize">
                  {role === 'manager' ? 'Менеджер' : role === 'production' ? 'Производство' : role === 'seo' ? 'SEO' : 'CEO'}
                </div>
              )}
            </div>
          </Link>

          {isAdmin && (
            <div className="px-3 pb-3">
              <div className="flex bg-[#f5f5f3] rounded-[8px] p-0.5 gap-0.5">
                {([
                  { v: 'manager', l: 'Менеджер' },
                  { v: 'admin',   l: 'Админ'    },
                  { v: 'ceo',     l: 'СЕО'      },
                ] as { v: ViewMode; l: string }[]).map(({ v, l }) => (
                  <button key={v} onClick={() => switchMode(v)}
                    className={`flex-1 py-[5px] rounded-[6px] text-[10px] font-semibold transition-all ${
                      viewMode === v ? 'bg-white text-[#111110] shadow-sm' : 'text-[#9a9a95] hover:text-[#6b6b66]'
                    }`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLocalhost && isAdmin && (
            <div className="px-3 pb-3">
              <button onClick={handleSync} disabled={syncState === 'loading'}
                className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-50 ${
                  syncState === 'ok'    ? 'bg-emerald-100 text-emerald-700' :
                  syncState === 'error' ? 'bg-red-50 text-red-600' :
                  'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4] hover:text-[#111110]'
                }`}>
                {syncState === 'loading' ? '...' :
                 syncState === 'ok'      ? '✓ Синхронизировано' :
                 syncState === 'error'   ? 'Ошибка синхронизации' : '↻ Синхронизировать'}
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {renderNav()}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-[#e4e4e0] flex-shrink-0">
          <div className="flex items-center gap-2 px-2 mb-1.5">
            <div className="w-6 h-6 rounded-full bg-[#f5f5f3] border border-[#e4e4e0] flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold text-[#6b6b66]">{(userEmail[0] ?? '?').toUpperCase()}</span>
            </div>
            <p className="text-[11px] text-[#9a9a95] truncate leading-tight">{userEmail}</p>
          </div>
          <button onClick={logout}
            className="w-full text-left px-2 py-1.5 rounded-lg text-[12px] text-[#9a9a95] hover:text-red-500 hover:bg-red-50 transition-colors">
            Выйти
          </button>
        </div>

      </aside>
    </>
  )
}
