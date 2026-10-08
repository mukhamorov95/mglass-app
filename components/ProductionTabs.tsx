'use client'

import { createContext, useContext, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Единая навигация цеха (production-app). Порядок = частота использования
// мастером: задачи → заказы, дальше экраны начальника и снабжения (тот же
// порядок, что в левом меню Sidebar). «Обзор» и «Станции» убраны (14.07):
// их закрывают «Мои задачи» (режим по материалу и толщине) и «Заказы».
const TABS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/production-app',          label: '🏠 Сегодня',     match: p => p === '/production-app' },
  { href: '/production-app/control',  label: '🔥 Табло',       match: p => p.startsWith('/production-app/control') },
  { href: '/production-app/my-queue', label: '✅ Мои задачи',   match: p => p.startsWith('/production-app/my-queue') },
  { href: '/production-app/load',     label: '📊 Загрузка',    match: p => p.startsWith('/production-app/load') },
  { href: '/production-app/activity', label: '👥 Кто что делал', match: p => p.startsWith('/production-app/activity') },
  { href: '/production-app/orders',   label: '📋 Заказы',      match: p => p === '/production-app/orders' },
  { href: '/production-app/metrics',  label: '📈 Метрики',     match: p => p.startsWith('/production-app/metrics') },
  { href: '/production-app/no-marks', label: '🕳 Без отметок',  match: p => p.startsWith('/production-app/no-marks') },
  { href: '/production-app/material', label: 'Материал',       match: p => p.startsWith('/production-app/material') },
  { href: '/production-app/remnants', label: '✂️ Остатки',     match: p => p.startsWith('/production-app/remnants') },
  { href: '/production-app/shipping', label: '📦 Отгрузка',    match: p => p.startsWith('/production-app/shipping') },
  { href: '/production-app/voronezh', label: '🚚 Воронеж',     match: p => p.startsWith('/production-app/voronezh') },
  { href: '/production-app/docs',     label: 'Документы',      match: p => p.startsWith('/production-app/docs') },
  { href: '/production-app/buy',      label: '🛒 Купить',      match: p => p.startsWith('/production-app/buy') },
  { href: '/production-app/ideas',    label: '💡 Идеи',        match: p => p.startsWith('/production-app/ideas') },
  { href: '/production-app/scan',     label: '📷 Скан',        match: p => p.startsWith('/production-app/scan') },
  { href: '/production-app/guide',    label: '📘 Регламент',   match: p => p.startsWith('/production-app/guide') },
]

// Рабочему цеха с телефона 16 вкладок отодвигали очередь на пол-экрана. Ему — основные
// крупно и «Ещё ▸»; владелец и начальник видят всё, как раньше. Табло — среди основных:
// поручение ставит любой из цеха (решение владельца 08.10), путь к нему не прячем.
export const MAIN_FOR_SHOP = ['/production-app', '/production-app/control', '/production-app/my-queue', '/production-app/orders', '/production-app/shipping', '/production-app/scan']

// Открыта вкладка из «Ещё» — список раскрыт, иначе человек не видит, где он.
export function shopTabsView(path: string, more: boolean) {
  const main = MAIN_FOR_SHOP.map(h => TABS.find(t => t.href === h)).filter((t): t is typeof TABS[number] => !!t)
  const rest = TABS.filter(t => !MAIN_FOR_SHOP.includes(t.href))
  return { main, rest, open: more || rest.some(t => t.match(path)) }
}

// Роль приходит из layout цеха (серверный getUserProfile) — без лишнего запроса с каждой страницы.
const RoleCtx = createContext<string | null>(null)
export function ProductionRoleProvider({ role, children }: { role: string | null; children: React.ReactNode }) {
  return <RoleCtx.Provider value={role}>{children}</RoleCtx.Provider>
}

const pill = (active: boolean) =>
  `text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${active ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`

// Крупнее — под палец: высота ≥ 40 px.
const bigPill = (active: boolean) =>
  `text-[14px] font-semibold px-3.5 py-2.5 rounded-xl transition-colors ${active ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#3b3b38] active:bg-[#e4e4e0]'}`

export default function ProductionTabs({ extra }: { extra?: React.ReactNode }) {
  const path = usePathname()
  const onObzor = path === '/production-app' || path.startsWith('/production-app/board')
  // «Деньги» (витрина финмодели CFO) и «Заработок» (реферальные начисления) убраны из
  // навигации цеха (П6): к работе смены они не относятся и жили здесь исторически.
  // Файлы на месте — вернём по адресу, если окажутся кому-то нужны.
  const tabs = TABS
  const role = useContext(RoleCtx)
  const [more, setMore] = useState(false)

  if (role === 'production') {
    const { main, rest, open } = shopTabsView(path, more)
    return (
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          {main.map(t => <Link key={t.href} href={t.href} className={bigPill(t.match(path))}>{t.label}</Link>)}
          <button type="button" onClick={() => setMore(v => !v)} aria-expanded={open} className={bigPill(false)}>
            {open ? 'Ещё ▾' : 'Ещё ▸'}
          </button>
        </div>
        {open && (
          <div className="flex flex-wrap gap-1.5">
            {rest.map(t => <Link key={t.href} href={t.href} className={pill(t.match(path))}>{t.label}</Link>)}
          </div>
        )}
        {onObzor && extra && <div className="flex flex-wrap items-center gap-1.5">{extra}</div>}
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(t => <Link key={t.href} href={t.href} className={pill(t.match(path))}>{t.label}</Link>)}
      </div>
      {onObzor && extra && <div className="flex flex-wrap items-center gap-1.5">{extra}</div>}
    </div>
  )
}
