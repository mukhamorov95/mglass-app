'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { loadJson } from '@/lib/toast'
import { dueLabel, isOverdue } from '@/lib/shopBoard/model'
import type { BoardView } from '@/lib/shopBoard/server'

// Лента табло сверху «Цех сегодня», «Мои задачи» и «Мой день · B2B»: открытые поручения
// видны там, где человек и так начинает смену, — без отдельного захода на табло.
export default function BoardRibbon() {
  const [data, setData] = useState<BoardView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(0)

  useEffect(() => {
    let alive = true
    loadJson<BoardView>('/api/shop-board?lite=1').then(res => {
      if (!alive) return
      if (res.error !== null) { setErr(res.error); return }
      setErr(null)
      setData(res.data)
      setNow(Date.now())
    })
    return () => { alive = false }
  }, [tick])

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  if (err) {
    return (
      <p className="text-[12px] text-[#c23a2b] mb-3">
        Табло цеха не загрузилось: {err}. <button onClick={() => setTick(n => n + 1)} className="underline">Повторить</button>
      </p>
    )
  }
  if (!data || data.missing) return null

  const open = data.cards.filter(c => c.status === 'new' || c.status === 'in_progress')
  const done = data.cards.filter(c => c.status === 'done').length

  if (open.length === 0) {
    if (!data.me.canCreate) return null
    return (
      <Link href="/production-app/control" className="block text-[12px] text-[#9a9a95] mb-3 hover:text-[#111110]">
        🔥 Табло цеха: открытых поручений нет{done ? ` · готово ${done}` : ''} — поставить →
      </Link>
    )
  }

  const alarm = open.some(c => c.hot || isOverdue(c, now))
  return (
    <Link href="/production-app/control"
      className={`block rounded-2xl border-2 px-4 py-3 mb-3 bg-white hover:bg-[#fafaf9] ${alarm ? 'border-red-500' : 'border-amber-300'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[14px] font-bold text-[#111110]">🔥 Табло цеха · {open.length}</p>
        <span className="text-[12px] text-[#6b6b66] whitespace-nowrap">{done ? `готово ${done} · ` : ''}открыть →</span>
      </div>
      <ul className="mt-1.5 space-y-1">
        {open.slice(0, 3).map(c => {
          const due = dueLabel(c, now)
          const late = isOverdue(c, now)
          return (
            <li key={c.id} className="text-[13px] leading-snug">
              <span className="font-semibold text-[#111110]">{c.hot ? '🔥 ' : ''}{c.title}</span>
              {c.orders.length > 0 && <span className="text-[#6b6b66]"> · {c.orders.map(o => `${o.ref}${o.client ? ` ${o.client}` : ''}`).join(', ')}</span>}
              {due && <span className={late ? 'text-red-600 font-semibold' : 'text-amber-700'}> · {due}</span>}
              <span className="text-[#9a9a95]"> · {c.status === 'new' ? 'никто не взял' : `взял ${c.taken_by_name ?? '—'}`}</span>
            </li>
          )
        })}
      </ul>
      {open.length > 3 && <p className="text-[12px] text-[#9a9a95] mt-1">и ещё {open.length - 3}</p>}
    </Link>
  )
}
