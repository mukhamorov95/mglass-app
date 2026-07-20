'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Живая сводка Marketing Center: цифры из существующих API вместо слепого хаба.
type Stats = {
  contentIdeas: number; contentInWork: number; contentPublished: number
  tasksOpen: number; tasksOverdue: number
  refPending: number; refToPay: number; refToPaySum: number
  promosActive: number
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

export default function StatsBar() {
  const [s, setS] = useState<Stats | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const [content, tasks, partners, promos] = await Promise.all([
          fetch('/api/marketing/content').then(r => r.json()).catch(() => []),
          fetch('/api/marketing/tasks').then(r => r.json()).catch(() => []),
          fetch('/api/marketing/partners?referrals=1').then(r => r.json()).catch(() => ({})),
          fetch('/api/marketing/promos').then(r => r.json()).catch(() => []),
        ])
        const today = new Date().toISOString().slice(0, 10)
        type MkContent = { status: string }
        type MkTask = { status: string; deadline?: string | null }
        type MkReferral = { status?: string; commission_amount?: unknown }
        type MkPartner = { marketing_partner_referrals?: MkReferral[] }
        type MkPromo = { active?: boolean }
        const cArr: MkContent[] = Array.isArray(content) ? content : []
        const tArr: MkTask[] = Array.isArray(tasks) ? tasks : []
        const refs: MkReferral[] = Array.isArray(partners)
          ? (partners as MkPartner[]).flatMap(p => Array.isArray(p.marketing_partner_referrals) ? p.marketing_partner_referrals : [])
          : []
        const pArr: MkPromo[] = Array.isArray(promos) ? promos : []
        const open = tArr.filter(t => t.status === 'todo' || t.status === 'in_progress')
        setS({
          contentIdeas: cArr.filter(c => c.status === 'idea').length,
          contentInWork: cArr.filter(c => ['in_progress', 'filmed', 'editing'].includes(c.status)).length,
          contentPublished: cArr.filter(c => c.status === 'published').length,
          tasksOpen: open.length,
          tasksOverdue: open.filter(t => t.deadline && t.deadline < today).length,
          refPending: refs.filter(r => r.status === 'pending').length,
          refToPay: refs.filter(r => r.status === 'completed').length,
          refToPaySum: refs.filter(r => r.status === 'completed')
            .reduce((sum: number, r) => sum + (Number(r.commission_amount) || 0), 0),
          promosActive: pArr.filter(p => p.active).length,
        })
      } catch { /* сводка не критична */ }
    })()
  }, [])

  if (!s) return null

  const cards = [
    { href: '/marketing/content', label: 'Контент', value: `${s.contentInWork} в работе`, sub: `${s.contentIdeas} идей · ${s.contentPublished} опубликовано` },
    { href: '/marketing/tasks', label: 'Задачи', value: `${s.tasksOpen} открыто`, sub: s.tasksOverdue > 0 ? `⚠️ ${s.tasksOverdue} просрочено` : 'просроченных нет', warn: s.tasksOverdue > 0 },
    { href: '/marketing/partners', label: 'Партнёрам к выплате', value: fmt(s.refToPaySum), sub: `${s.refToPay} заверш. · ${s.refPending} в ожидании`, warn: s.refToPaySum > 0 },
    { href: '/marketing/promos', label: 'Акции', value: `${s.promosActive} активно`, sub: 'проверяй маржу ≥25%' },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      {cards.map(c => (
        <Link key={c.href} href={c.href}
          className={`rounded-xl border p-4 bg-white hover:shadow-sm transition-shadow ${c.warn ? 'border-amber-300' : 'border-[#e4e4e0]'}`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">{c.label}</p>
          <p className="text-[17px] font-bold text-[#111110] mt-1">{c.value}</p>
          <p className={`text-[11px] mt-0.5 ${c.warn ? 'text-amber-600' : 'text-[#9a9a95]'}`}>{c.sub}</p>
        </Link>
      ))}
    </div>
  )
}
