'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import type { Role } from '@/lib/getRole'

type Props = { userEmail: string; role: Role | null }

const MGLASS_NAV = [
  { href: '/calculator/mirror', label: 'Зеркало' },
  { href: '/calculator/loft',   label: 'Лофт' },
  { href: '/calculator/shower', label: 'Душевые' },
  { href: '/calculations',      label: 'История' },
  { href: '/b2b-quotes',        label: 'Просчёты' },
]

const PRODUCTION_NAV = [
  { href: '/calculator/b2b', label: 'B2B калькулятор' },
  { href: '/b2b-orders',     label: 'Заказы' },
  { href: '/production',     label: 'Производство' },
]

const ADMIN_NAV = [
  { href: '/admin/materials',     label: 'Материалы' },
  { href: '/admin/services',      label: 'Услуги' },
  { href: '/admin/hardware',      label: 'Фурнитура' },
  { href: '/admin/settings',      label: 'Настройки' },
  { href: '/admin/b2b-clients',   label: 'B2B Клиенты' },
  { href: '/admin/b2b-materials', label: 'B2B Материалы' },
  { href: '/admin/b2b-services',  label: 'B2B Услуги' },
  { href: '/b2b-analytics',       label: 'Аналитика' },
]

function detectSection(pathname: string): 'mglass' | 'production' {
  const productionPaths = ['/calculator/b2b', '/b2b-orders', '/production', '/b2b-analytics']
  if (productionPaths.some(p => pathname === p || pathname.startsWith(p + '/'))) return 'production'
  return 'mglass'
}

export function Header({ userEmail, role }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  const [section, setSection] = useState<'mglass' | 'production'>(() => detectSection(pathname))

  useEffect(() => {
    setSection(detectSection(pathname))
  }, [pathname])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/')
  }

  const activeNav = section === 'mglass' ? MGLASS_NAV : PRODUCTION_NAV

  return (
    <header className="bg-white border-b border-[#e4e4e0] sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-4 h-12 flex items-center gap-2">

        {/* Лого */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <div className="w-6 h-6 bg-[#111110] rounded-[4px] flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">MG</span>
          </div>
        </Link>

        <div className="h-4 w-px bg-[#e4e4e0] flex-shrink-0" />

        {/* Переключатели секций */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => { setSection('mglass'); router.push('/calculator/mirror') }}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-bold transition-all ${
              section === 'mglass'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-[#6b6b66] hover:bg-[#f0f0ec] hover:text-[#111110]'
            }`}>
            МГласс
          </button>
          <button
            onClick={() => { setSection('production'); router.push('/production') }}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-bold transition-all ${
              section === 'production'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-[#6b6b66] hover:bg-[#f0f0ec] hover:text-[#111110]'
            }`}>
            Производство
          </button>
        </div>

        <div className="h-4 w-px bg-[#e4e4e0] flex-shrink-0" />

        {/* Навигация активной секции */}
        <nav className="flex items-center gap-0.5 flex-1 overflow-x-auto">
          {activeNav.map(item => (
            <Link key={item.href} href={item.href}
              className={`px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                isActive(item.href)
                  ? section === 'mglass'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-orange-50 text-orange-700'
                  : 'text-[#6b6b66] hover:text-[#111110] hover:bg-[#f8f8f7]'
              }`}>
              {item.label}
            </Link>
          ))}

          {/* Админ-ссылки в конце */}
          {role === 'admin' && (
            <>
              <div className="h-4 w-px bg-[#e4e4e0] mx-1 flex-shrink-0" />
              {ADMIN_NAV.map(item => (
                <Link key={item.href} href={item.href}
                  className={`px-2.5 py-1.5 rounded-md text-[13px] transition-colors whitespace-nowrap flex-shrink-0 ${
                    isActive(item.href)
                      ? 'bg-[#f0f0ec] text-[#111110] font-medium'
                      : 'text-[#9a9a95] hover:text-[#6b6b66] hover:bg-[#f8f8f7]'
                  }`}>
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>

        {/* Пользователь */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {role === 'admin' && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-purple-50 text-purple-700">Админ</span>
          )}
          <span className="text-[12px] text-[#9a9a95] hidden lg:block">{userEmail}</span>
          <button onClick={handleLogout}
            className="text-[12px] text-[#9a9a95] hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-red-50">
            Выйти
          </button>
        </div>

      </div>
    </header>
  )
}
