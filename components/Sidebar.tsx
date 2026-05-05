'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import type { Role } from '@/lib/getRole'

type Props = { userEmail: string; role: Role | null }
type SyncState = 'idle' | 'loading' | 'ok' | 'error'

const MGLASS_NAV = [
  { href: '/calculator/mirror', label: 'Зеркало с подсветкой' },
  { href: '/calculator/loft',   label: 'Лофт-перегородка' },
  { href: '/calculator/shower', label: 'Душевая перегородка' },
  { href: '/calculations',      label: 'История расчётов' },
  { href: '/orders',            label: 'История заказов' },
  { href: '/my-earnings',       label: '💰 Мои заработки' },
]

const AI_NAV = [
  { href: '/my-dashboard',   label: 'Дашборд' },
  { href: '/amo-analysis',   label: '📊 Анализ воронки' },
  { href: '/ai-stats',       label: '🤖 Диалоги Владислава' },
  { href: '/my-notes',       label: '🎙️ Мои заметки' },
  { href: '/ai-assistant',   label: 'AI Ассистент' },
  { href: '/kp-generator',   label: 'КП Генератор' },
  { href: '/objections',     label: 'Возражения' },
  { href: '/product-finder', label: 'Подбор продукта' },
  { href: '/templates',      label: 'Шаблоны' },
  { href: '/deal-analysis',  label: 'Анализ сделки' },
  { href: '/competitors',    label: 'Конкуренты' },
]

const PRODUCTION_NAV = [
  { href: '/calculator/b2b', label: 'B2B Калькулятор' },
  { href: '/b2b-quotes',     label: 'B2B Просчёты' },
  { href: '/b2b-orders',     label: 'B2B Заказы' },
  { href: '/production',     label: 'Производство' },
]

const ADMIN_NAV = [
  { href: '/admin/analytics-mglass', label: 'Аналитика МГласс' },
  { href: '/admin/materials',     label: 'Материалы' },
  { href: '/admin/services',      label: 'Услуги' },
  { href: '/admin/hardware',          label: 'Фурнитура лофт' },
  { href: '/admin/shower-hardware',   label: 'Фурнитура душевые' },
  { href: '/admin/settings',      label: 'Финансовые настройки' },
  { href: '/admin/b2b-clients',   label: 'B2B Клиенты' },
  { href: '/admin/b2b-materials', label: 'B2B Материалы' },
  { href: '/admin/b2b-services',  label: 'B2B Услуги' },
  { href: '/b2b-analytics',       label: 'B2B Аналитика' },
  { href: '/admin/users',         label: 'Пользователи' },
]

const AI_PATHS = ['/ai-assistant', '/kp-generator', '/objections', '/product-finder', '/templates', '/deal-analysis', '/competitors', '/my-dashboard', '/amo-analysis']
const PRODUCTION_PATHS = ['/calculator/b2b', '/b2b-quotes', '/b2b-orders', '/production', '/b2b-analytics']
const ADMIN_PATHS = ['/admin']

function detectSection(pathname: string): 'mglass' | 'ai' | 'production' | 'admin' {
  if (AI_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) return 'ai'
  if (PRODUCTION_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) return 'production'
  if (ADMIN_PATHS.some(p => pathname.startsWith(p))) return 'admin'
  return 'mglass'
}

export function Sidebar({ userEmail, role }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  if (pathname?.endsWith('/print')) return null

  const activeSection = detectSection(pathname)
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set([activeSection]))
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost'

  async function handleSync() {
    setSyncState('loading')
    try {
      const res = await fetch('/api/admin/sync', { method: 'POST' })
      const data = await res.json()
      setSyncState(data.ok ? 'ok' : 'error')
      if (data.ok) setTimeout(() => setSyncState('idle'), 3000)
    } catch {
      setSyncState('error')
    }
  }

  function toggleSection(key: string) {
    setOpenSections(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col bg-white border-r border-[#e4e4e0] min-h-screen sticky top-0 h-screen overflow-y-auto">

      {/* Лого */}
      <div className="border-b border-[#e4e4e0]">
        <Link href="/" className="flex items-center gap-2.5 px-4 py-4">
          <div className="w-7 h-7 bg-[#111110] rounded-[5px] flex items-center justify-center flex-shrink-0">
            <span className="text-white text-[11px] font-bold">MG</span>
          </div>
          <span className="text-[15px] font-bold text-[#111110] tracking-tight">MGlass</span>
        </Link>

        {isLocalhost && (
          <div className="px-3 pb-3">
            <button
              onClick={handleSync}
              disabled={syncState === 'loading'}
              className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-60 ${
                syncState === 'ok'
                  ? 'bg-emerald-100 text-emerald-700'
                  : syncState === 'error'
                  ? 'bg-red-50 text-red-600'
                  : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4] hover:text-[#111110]'
              }`}>
              {syncState === 'loading' ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : syncState === 'ok' ? (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              )}
              {syncState === 'loading' ? 'Синхронизация...' : syncState === 'ok' ? 'Готово ✓' : syncState === 'error' ? 'Ошибка' : 'Синхронизировать'}
            </button>
          </div>
        )}
      </div>

      {/* Навигация */}
      <nav className="flex-1 px-3 py-3 space-y-1">

        {/* МГласс */}
        <div>
          <button
            onClick={() => toggleSection('mglass')}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#f8f8f7] transition-colors group">
            <span className="text-[12px] font-bold text-blue-600 uppercase tracking-widest">МГласс</span>
            <svg
              className={`w-3.5 h-3.5 text-blue-400 transition-transform ${openSections.has('mglass') ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openSections.has('mglass') && (
            <div className="space-y-0.5 mt-0.5">
              {MGLASS_NAV.filter(item =>
                item.href !== '/my-earnings' || role === 'admin' || role === 'manager'
              ).map(item => (
                <Link key={item.href} href={item.href}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors ${
                    isActive(item.href)
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'text-[#6b6b66] hover:bg-[#f8f8f7] hover:text-[#111110]'
                  }`}>
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* AI Продажи */}
        <div>
          <button
            onClick={() => toggleSection('ai')}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#f8f8f7] transition-colors group">
            <span className="text-[12px] font-bold text-emerald-600 uppercase tracking-widest">AI Продажи</span>
            <svg
              className={`w-3.5 h-3.5 text-emerald-400 transition-transform ${openSections.has('ai') ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openSections.has('ai') && (
            <div className="space-y-0.5 mt-0.5">
              {AI_NAV.map(item => (
                <Link key={item.href} href={item.href}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors ${
                    isActive(item.href)
                      ? 'bg-emerald-50 text-emerald-700 font-semibold'
                      : 'text-[#6b6b66] hover:bg-[#f8f8f7] hover:text-[#111110]'
                  }`}>
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Производство */}
        <div>
          <button
            onClick={() => toggleSection('production')}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#f8f8f7] transition-colors group">
            <span className="text-[12px] font-bold text-orange-600 uppercase tracking-widest">Производство</span>
            <svg
              className={`w-3.5 h-3.5 text-orange-400 transition-transform ${openSections.has('production') ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openSections.has('production') && (
            <div className="space-y-0.5 mt-0.5">
              {PRODUCTION_NAV.map(item => (
                <Link key={item.href} href={item.href}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors ${
                    isActive(item.href)
                      ? 'bg-orange-50 text-orange-700 font-semibold'
                      : 'text-[#6b6b66] hover:bg-[#f8f8f7] hover:text-[#111110]'
                  }`}>
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Администрирование */}
        {role === 'admin' && (
          <div>
            <button
              onClick={() => toggleSection('admin')}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#f8f8f7] transition-colors group">
              <span className="text-[12px] font-bold text-purple-600 uppercase tracking-widest">Админ</span>
              <svg
                className={`w-3.5 h-3.5 text-purple-400 transition-transform ${openSections.has('admin') ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {openSections.has('admin') && (
              <div className="space-y-0.5 mt-0.5">
                {ADMIN_NAV.map(item => (
                  <Link key={item.href} href={item.href}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] transition-colors ${
                      isActive(item.href)
                        ? 'bg-purple-50 text-purple-700 font-semibold'
                        : 'text-[#9a9a95] hover:bg-[#f8f8f7] hover:text-[#6b6b66]'
                    }`}>
                    {item.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

      </nav>

      {/* Пользователь внизу */}
      <div className="px-3 py-3 border-t border-[#e4e4e0]">
        <p className="text-[11px] text-[#9a9a95] px-2 mb-1.5 truncate">{userEmail}</p>
        <button onClick={handleLogout}
          className="w-full text-left px-2 py-1.5 rounded-lg text-[13px] text-[#9a9a95] hover:text-red-500 hover:bg-red-50 transition-colors">
          Выйти
        </button>
      </div>

    </aside>
  )
}
