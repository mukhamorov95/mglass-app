'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Единая навигация цеха (production-app). Порядок = частота использования
// мастером: задачи → заказы, дальше экраны начальника и снабжения (тот же
// порядок, что в левом меню Sidebar). «Обзор» и «Станции» убраны (14.07):
// их закрывают «Мои задачи» (режим по материалу и толщине) и «Заказы».
const TABS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/production-app/my-queue', label: '✅ Мои задачи',   match: p => p.startsWith('/production-app/my-queue') },
  { href: '/production-app/load',     label: '📊 Загрузка',    match: p => p.startsWith('/production-app/load') },
  { href: '/production-app/activity', label: '👥 Кто что делал', match: p => p.startsWith('/production-app/activity') },
  { href: '/production-app/orders',   label: '📋 Заказы',      match: p => p === '/production-app/orders' },
  { href: '/production-app/metrics',  label: '📈 Метрики',     match: p => p.startsWith('/production-app/metrics') },
  { href: '/production-app/material', label: 'Материал',       match: p => p.startsWith('/production-app/material') },
  { href: '/production-app/shipping', label: '📦 Отгрузка',    match: p => p.startsWith('/production-app/shipping') },
  { href: '/production-app/voronezh', label: '🚚 Воронеж',     match: p => p.startsWith('/production-app/voronezh') },
  { href: '/production-app/docs',     label: 'Документы',      match: p => p.startsWith('/production-app/docs') },
  { href: '/production-app/buy',      label: '🛒 Купить',      match: p => p.startsWith('/production-app/buy') },
  { href: '/production-app/ideas',    label: '💡 Идеи',        match: p => p.startsWith('/production-app/ideas') },
  { href: '/production-app/scan',     label: '📷 Скан',        match: p => p.startsWith('/production-app/scan') },
  { href: '/production-app/guide',    label: '📘 Регламент',   match: p => p.startsWith('/production-app/guide') },
]

const pill = (active: boolean) =>
  `text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${active ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`

export default function ProductionTabs({ extra }: { extra?: React.ReactNode }) {
  const path = usePathname()
  const onObzor = path === '/production-app' || path.startsWith('/production-app/board')
  // «Деньги» (витрина финмодели CFO) и «Заработок» (реферальные начисления) убраны из
  // навигации цеха (П6): к работе смены они не относятся и жили здесь исторически.
  // Файлы на месте — вернём по адресу, если окажутся кому-то нужны.
  const tabs = TABS

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(t => <Link key={t.href} href={t.href} className={pill(t.match(path))}>{t.label}</Link>)}
      </div>
      {onObzor && extra && <div className="flex flex-wrap items-center gap-1.5">{extra}</div>}
    </div>
  )
}
