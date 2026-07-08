'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Единая навигация цеха (production-app). «Обзор» = два вида: по срокам (/production-app)
// и матрица заказ×этап (/production-app/board). Остальное — операционные экраны.
const TABS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/production-app',          label: 'Обзор',          match: p => p === '/production-app' || p.startsWith('/production-app/board') },
  { href: '/production-app/today',    label: 'Пул на сегодня', match: p => p.startsWith('/production-app/today') },
  { href: '/production-app/station',  label: 'Станции',        match: p => p.startsWith('/production-app/station') },
  { href: '/production-app/my-queue', label: 'Мои задачи',     match: p => p.startsWith('/production-app/my-queue') },
  { href: '/production-app/material', label: 'Материал',       match: p => p.startsWith('/production-app/material') },
  { href: '/production-app/docs',     label: 'Документы',      match: p => p.startsWith('/production-app/docs') },
  { href: '/production-app/ideas',    label: '💡 Идеи',        match: p => p.startsWith('/production-app/ideas') },
  { href: '/production-app/buy',      label: '🛒 Купить',      match: p => p.startsWith('/production-app/buy') },
  { href: '/production-app/guide',    label: '📘 Регламент',   match: p => p.startsWith('/production-app/guide') },
]

const pill = (active: boolean) =>
  `text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${active ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`
const subPill = (active: boolean) =>
  `text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${active ? 'bg-white border-[#111110] text-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f0f0ec]'}`

export default function ProductionTabs({ extra }: { extra?: React.ReactNode }) {
  const path = usePathname()
  const onObzor = path === '/production-app' || path.startsWith('/production-app/board')
  // «Заработок» — только реферерам (users.referral_rate_pct задан).
  const [isReferrer, setIsReferrer] = useState(false)
  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      sb.from('users').select('referral_rate_pct').eq('id', user.id).single()
        .then(({ data }) => { if ((data as { referral_rate_pct: number | null } | null)?.referral_rate_pct != null) setIsReferrer(true) })
    })
  }, [])

  const tabs = isReferrer
    ? [...TABS, { href: '/production-app/earnings', label: '💰 Заработок', match: (p: string) => p.startsWith('/production-app/earnings') }]
    : TABS

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(t => <Link key={t.href} href={t.href} className={pill(t.match(path))}>{t.label}</Link>)}
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
