'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Единая навигация цеха (production-app). «Обзор» = два вида: по срокам (/production-app)
// и матрица заказ×этап (/production-app/board). Остальное — операционные экраны.
const TABS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/production-app',          label: 'Обзор',           match: p => p === '/production-app' || p.startsWith('/production-app/board') },
  { href: '/production-app/today',    label: 'Пул по станциям', match: p => p.startsWith('/production-app/today') },
  { href: '/production-app/my-queue', label: 'Мои задачи',      match: p => p.startsWith('/production-app/my-queue') },
  { href: '/production-app/material', label: 'Материал',        match: p => p.startsWith('/production-app/material') },
  { href: '/production-app/docs',     label: 'Документы',       match: p => p.startsWith('/production-app/docs') },
]

const pill = (active: boolean) =>
  `text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${active ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`
const subPill = (active: boolean) =>
  `text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${active ? 'bg-white border-[#111110] text-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f0f0ec]'}`

export default function ProductionTabs({ extra }: { extra?: React.ReactNode }) {
  const path = usePathname()
  const onObzor = path === '/production-app' || path.startsWith('/production-app/board')

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => <Link key={t.href} href={t.href} className={pill(t.match(path))}>{t.label}</Link>)}
      </div>
      {onObzor && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-[#9a9a95] uppercase tracking-wide mr-0.5">Вид:</span>
          <Link href="/production-app" className={subPill(path === '/production-app')}>📅 По срокам</Link>
          <Link href="/production-app/board" className={subPill(path.startsWith('/production-app/board'))}>🔲 Матрица</Link>
          {extra}
        </div>
      )}
    </div>
  )
}
