'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import type { Role } from '@/lib/getRole'

type Props = { userEmail: string; role: Role | null }
type SyncState = 'idle' | 'loading' | 'ok' | 'error'
type ViewMode = 'manager' | 'admin'

// Nav entry can be a link or a visual group label (non-clickable)
type NavItem  = { href: string; label: string; icon: string; indent?: boolean }
type NavGroup = { groupLabel: string }
type NavEntry = NavItem | NavGroup

function isGroup(e: NavEntry): e is NavGroup { return 'groupLabel' in e }

// ─── Navigation data ─────────────────────────────────────────────────────────

const MANAGER_EARNINGS: NavItem[] = [
  { href: '/my-earnings', label: 'Мои заработки', icon: '💰' },
]

const MANAGER_CALCULATOR: NavItem[] = [
  { href: '/calculator/mirror', label: 'Зеркало', icon: '🪞' },
  { href: '/calculator/shower', label: 'Душевая', icon: '🚿' },
  { href: '/calculator/loft',   label: 'Лофт-перегородка', icon: '🏗️' },
]

const MANAGER_SALES: NavItem[] = [
  { href: '/calculations', label: 'История расчётов', icon: '📋' },
  { href: '/orders',       label: 'Заказы', icon: '📦' },
  { href: '/clients',      label: 'Клиенты', icon: '👤' },
  { href: '/calendar',     label: 'Календарь', icon: '📅' },
  { href: '/measurer',     label: 'Форма замера', icon: '📐' },
]

const MANAGER_PRODUCTION: NavItem[] = [
  { href: '/manager-dashboard', label: 'Дашборд менеджера', icon: '🎯' },
  { href: '/b2b-crm',           label: 'B2B CRM',           icon: '🗂️' },
  { href: '/calculator/b2b',    label: 'B2B Калькулятор',   icon: '🏭' },
  { href: '/b2b-quotes',        label: 'B2B Просчёты',      icon: '📝' },
  { href: '/b2b-orders',        label: 'B2B Заказы',        icon: '📦' },
  { href: '/b2b-pipeline',      label: 'Воронка продаж',    icon: '📌' },
  { href: '/b2b-production',    label: 'Производство B2B',  icon: '🔧' },
  { href: '/production',        label: 'Производство',      icon: '⚙️' },
  { href: '/b2b-analytics',     label: 'B2B Аналитика',     icon: '📊' },
]

const MANAGER_MARKETING: NavItem[] = [
  { href: '/marketing',                label: 'Marketing Center',  icon: '📣' },
  { href: '/marketing/content',        label: 'Контент-план',      icon: '📅' },
  { href: '/marketing/video-factory',  label: 'AI Video Factory',  icon: '🎬' },
  { href: '/marketing/media-library',  label: 'Медиабиблиотека',   icon: '🖼️' },
  { href: '/marketing/daily',          label: 'Дневной план AI',   icon: '✨' },
  { href: '/marketing/partners',       label: 'Партнёры',          icon: '🤝' },
  { href: '/marketing/promos',         label: 'Акции',             icon: '🎁' },
  { href: '/marketing/tasks',          label: 'Задачи',            icon: '✅' },
  { href: '/marketing/ai',             label: 'AI-маркетолог',    icon: '🤖' },
]

const MANAGER_AI: NavItem[] = [
  { href: '/ai-assistant',   label: 'AI Ассистент', icon: '🤖' },
  { href: '/kp-generator',   label: 'КП Генератор', icon: '📄' },
  { href: '/objections',     label: 'Возражения', icon: '💬' },
  { href: '/product-finder', label: 'Подбор продукта', icon: '🔍' },
  { href: '/deal-analysis',  label: 'Анализ сделки', icon: '📊' },
  { href: '/templates',      label: 'Шаблоны', icon: '📋' },
  { href: '/competitors',    label: 'Конкуренты', icon: '⚔️' },
]

const ADMIN_OWNER: NavItem[] = [
  { href: '/admin/owner',            label: 'Owner Center', icon: '👑' },
  { href: '/admin/dashboard',        label: 'Дашборд', icon: '📊' },
  { href: '/admin/pnl',              label: 'P&L отчёт', icon: '📈' },
  { href: '/admin/analytics-mglass', label: 'Аналитика', icon: '🔍' },
  { href: '/admin/bonus-center',     label: 'Bonus Center', icon: '🎁' },
  { href: '/admin/sales-center',     label: 'Sales Center', icon: '📣' },
  { href: '/admin/b2b-development',  label: 'B2B Development', icon: '🤝' },
  { href: '/admin/org',              label: 'Оргструктура', icon: '🏗️' },
  { href: '/admin/users',            label: 'Пользователи', icon: '👥' },
]

const ADMIN_PRODUCT_LINE: NavItem[] = [
  { href: '/admin/product-line',           label: 'Продуктовая линейка', icon: '📦' },
  { href: '/admin/product-line/catalog',   label: 'Каталог серий',       icon: '🪞' },
  { href: '/admin/b2b-presentation',       label: 'B2B Презентация',     icon: '🎯' },
]

const ADMIN_VLADISLAV: NavItem[] = [
  { href: '/vladislav',               label: 'Сообщения', icon: '💬' },
  { href: '/ai-stats',                label: 'Статистика бота', icon: '📊' },
  { href: '/vladislav/manager-stats', label: 'Аналитика менеджеров', icon: '👥' },
  { href: '/amo-analysis',            label: 'Воронка AMO', icon: '🔍' },
  { href: '/vladislav/tasks',         label: 'Задачи AI', icon: '🗂️' },
  { href: '/admin/integrations',      label: 'Avito / AMO Monitor', icon: '🔗' },
]

// ─── СПРАВОЧНИКИ — new clean structure ───────────────────────────────────────
// Group labels inside accordion (non-clickable visual separators)
const ADMIN_DIRECTORIES: NavEntry[] = [
  { href: '/admin/glass-prices',    label: 'Стекло',            icon: '🔷' },
  { href: '/admin/services',        label: 'Услуги',            icon: '🔧' },
  { groupLabel: 'Фурнитура' },
  { href: '/admin/hardware',        label: 'Лофт',              icon: '🔩', indent: true },
  { href: '/admin/shower-hardware', label: 'Душевые',           icon: '🚿', indent: true },
  { href: '/admin/settings',        label: 'Фин. настройки',    icon: '💰' },
  { href: '/admin/suppliers',       label: 'Поставщики',        icon: '🏭' },
  { href: '/admin/architecture',    label: 'Карта данных',      icon: '🗺️' },
]

// B2B — separate accordion (de-clutters Справочники, still accessible)
const ADMIN_B2B: NavEntry[] = [
  { href: '/admin/b2b-clients',   label: 'Клиенты',   icon: '🏢' },
  { href: '/admin/b2b-materials', label: 'Материалы', icon: '🧱' },
  { href: '/admin/b2b-services',  label: 'Услуги',    icon: '🔧' },
]

const ADMIN_OPERATIONS: NavItem[] = [
  { href: '/admin/warehouse',      label: 'Склад', icon: '📦' },
  { href: '/admin/route-sheet',    label: 'Маршрутный лист', icon: '🚚' },
  { href: '/admin/brigades',       label: 'Бригады', icon: '👷' },
  { href: '/admin/delivery-zones', label: 'Зоны доставки', icon: '🚗' },
]

const ADMIN_SYSTEM: NavItem[] = [
  { href: '/admin/pricing-manual',      label: 'Pricing Manual', icon: '📖' },
  { href: '/admin/owner-questionnaire', label: 'Стратегия',      icon: '🎯' },
  { href: '/admin/roadmap',             label: 'Roadmap',        icon: '🗺️' },
  { href: '/admin/infrastructure',      label: 'Техцентр',       icon: '⚙️' },
  { href: '/admin/shower-images',       label: 'Media Library',  icon: '🖼️' },
]

// ─── Path helpers ─────────────────────────────────────────────────────────────

const SECTION_PATHS: Record<string, string[]> = {
  calculator:  ['/calculator/mirror', '/calculator/shower', '/calculator/loft'],
  sales:       ['/calculations', '/orders', '/clients', '/calendar', '/measurer'],
  production:  ['/manager-dashboard', '/b2b-crm', '/calculator/b2b', '/b2b-quotes', '/b2b-orders', '/b2b-pipeline', '/b2b-production', '/production', '/b2b-analytics'],
  marketing:   ['/marketing', '/marketing/video-factory', '/marketing/media-library', '/marketing/daily'],
  ai:          ['/ai-assistant', '/kp-generator', '/objections', '/product-finder', '/deal-analysis', '/templates', '/competitors'],
  vladislav:   ['/vladislav', '/ai-stats', '/amo-analysis', '/admin/integrations'],
  directories: ['/admin/glass-prices', '/admin/services', '/admin/hardware', '/admin/shower-hardware', '/admin/settings', '/admin/suppliers', '/admin/architecture'],
  b2b:         ['/admin/b2b-clients', '/admin/b2b-materials', '/admin/b2b-services'],
  operations:  ['/admin/warehouse', '/admin/route-sheet', '/admin/suppliers', '/admin/brigades', '/admin/delivery-zones'],
  productline: ['/admin/product-line', '/admin/b2b-presentation'],
  system:      ['/admin/pricing-manual', '/admin/owner-questionnaire', '/admin/bonus-center', '/admin/sales-center', '/admin/b2b-development', '/admin/roadmap', '/admin/infrastructure', '/admin/shower-images'],
}

function inSection(pathname: string, paths: string[]): boolean {
  return paths.some(p => pathname === p || pathname.startsWith(p + '/'))
}

function autoOpenSections(pathname: string, mode: ViewMode): string[] {
  const open: string[] = []
  if (mode === 'manager') {
    if (inSection(pathname, SECTION_PATHS.calculator)) open.push('calculator')
    if (inSection(pathname, SECTION_PATHS.sales))      open.push('sales')
    if (inSection(pathname, SECTION_PATHS.production)) open.push('production')
    if (inSection(pathname, SECTION_PATHS.ai))         open.push('ai')
  } else {
    if (inSection(pathname, SECTION_PATHS.marketing))    open.push('marketing')
    if (inSection(pathname, SECTION_PATHS.vladislav))    open.push('vladislav')
    if (inSection(pathname, SECTION_PATHS.productline))  open.push('productline')
    if (inSection(pathname, SECTION_PATHS.directories))  open.push('directories')
    if (inSection(pathname, SECTION_PATHS.b2b))          open.push('b2b')
    if (inSection(pathname, SECTION_PATHS.operations))   open.push('operations')
    if (inSection(pathname, SECTION_PATHS.system))       open.push('system')
  }
  return open
}

function detectModeFromPath(pathname: string): ViewMode {
  if (
    pathname.startsWith('/admin') ||
    inSection(pathname, SECTION_PATHS.vladislav) ||
    inSection(pathname, SECTION_PATHS.marketing)
  ) return 'admin'
  return 'manager'
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar({ userEmail, role }: Props) {
  const router   = useRouter()
  const pathname = usePathname()

  if (pathname?.endsWith('/print')) return null

  const isAdmin = role === 'admin'

  const [viewMode, setViewMode]     = useState<ViewMode>('manager')
  const [open, setOpen]             = useState<Set<string>>(new Set(['calculator']))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [syncState, setSyncState]   = useState<SyncState>('idle')
  const [isLocalhost, setIsLocalhost] = useState(false)

  useEffect(() => {
    setIsLocalhost(window.location.hostname === 'localhost')
    const saved = localStorage.getItem('sidebarMode') as ViewMode | null
    const mode: ViewMode = isAdmin ? (saved ?? detectModeFromPath(pathname)) : 'manager'
    setViewMode(mode)
    const auto = autoOpenSections(pathname, mode)
    setOpen(new Set(auto.length ? auto : [mode === 'manager' ? 'calculator' : 'vladislav']))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const auto = autoOpenSections(pathname, viewMode)
    if (auto.length) setOpen(prev => new Set([...prev, ...auto]))
  }, [pathname, viewMode])

  function switchMode(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem('sidebarMode', mode)
    const auto = autoOpenSections(pathname, mode)
    setOpen(new Set(auto.length ? auto : [mode === 'manager' ? 'calculator' : 'vladislav']))
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

  // Accordion that supports NavEntry (items + group separators)
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

  const sectionLabel = (label: string) => (
    <div className="px-2.5 pt-3.5 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-[#c4c4be]">
      {label}
    </div>
  )

  const divider = () => <div className="my-2 border-t border-[#f0f0ec]" />

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
            <span className="text-[15px] font-bold text-[#111110] tracking-tight">MGlass</span>
          </Link>

          {isAdmin && (
            <div className="px-3 pb-3">
              <div className="flex bg-[#f5f5f3] rounded-[8px] p-0.5 gap-0.5">
                {(['manager', 'admin'] as const).map(mode => (
                  <button key={mode} onClick={() => switchMode(mode)}
                    className={`flex-1 py-[5px] rounded-[6px] text-[11px] font-semibold transition-all ${
                      viewMode === mode ? 'bg-white text-[#111110] shadow-sm' : 'text-[#9a9a95] hover:text-[#6b6b66]'
                    }`}>
                    {mode === 'manager' ? 'Менеджер' : 'Администратор'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLocalhost && (
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

          {viewMode === 'manager' ? (
            <>
              {sectionLabel('Мои заработки')}
              {MANAGER_EARNINGS.map(i => navItem(i, 'bg-[#111110] text-white font-semibold'))}

              {divider()}

              {accordion('calculator', 'MGlass Калькулятор',
                'text-blue-600', 'text-blue-400', MANAGER_CALCULATOR, 'bg-blue-50 text-blue-700 font-semibold')}
              {accordion('sales', 'MGlass Продажи',
                'text-blue-600', 'text-blue-400', MANAGER_SALES, 'bg-blue-50 text-blue-700 font-semibold')}

              {divider()}

              {accordion('production', 'Производство',
                'text-orange-600', 'text-orange-400', MANAGER_PRODUCTION, 'bg-orange-50 text-orange-700 font-semibold')}

              {divider()}

              {accordion('ai', 'AI Инструменты',
                'text-violet-600', 'text-violet-400', MANAGER_AI, 'bg-violet-50 text-violet-700 font-semibold')}
            </>
          ) : (
            <>
              {sectionLabel('Owner Center')}
              {ADMIN_OWNER.map(i => navItem(i, 'bg-purple-50 text-purple-700 font-semibold'))}

              {divider()}

              {accordion('marketing', 'Маркетинг',
                'text-rose-600', 'text-rose-400', MANAGER_MARKETING, 'bg-rose-50 text-rose-700 font-semibold')}

              {divider()}

              {accordion('productline', 'Product Line',
                'text-violet-600', 'text-violet-400', ADMIN_PRODUCT_LINE, 'bg-violet-50 text-violet-700 font-semibold')}

              {divider()}

              {accordion('vladislav', 'Vladislav AI',
                'text-indigo-600', 'text-indigo-400', ADMIN_VLADISLAV, 'bg-indigo-50 text-indigo-700 font-semibold')}

              {divider()}

              {/* СПРАВОЧНИКИ — clean new structure */}
              {accordion('directories', 'Справочники',
                'text-[#6b6b66]', 'text-[#9a9a95]', ADMIN_DIRECTORIES, 'bg-[#f5f5f3] text-[#111110] font-semibold')}

              {/* B2B — own section */}
              {accordion('b2b', 'B2B',
                'text-[#6b6b66]', 'text-[#9a9a95]', ADMIN_B2B, 'bg-[#f5f5f3] text-[#111110] font-semibold')}

              {/* ОПЕРАЦИИ */}
              {accordion('operations', 'Операции',
                'text-[#6b6b66]', 'text-[#9a9a95]', ADMIN_OPERATIONS, 'bg-[#f5f5f3] text-[#111110] font-semibold')}

              {/* СИСТЕМА */}
              {accordion('system', 'Система',
                'text-[#6b6b66]', 'text-[#9a9a95]', ADMIN_SYSTEM, 'bg-[#f5f5f3] text-[#111110] font-semibold')}
            </>
          )}

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
