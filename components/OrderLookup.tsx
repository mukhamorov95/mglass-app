'use client'

// Ответ на номер или клиента среди всех заказов: отгружен, на каком этапе, в архиве, чужой клиент.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { FoundOrder } from '@/lib/b2b/findOrders'
import { loadJson } from '@/lib/toast'

const fmtDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`

export default function OrderLookup({ query, linkBase, title = 'Среди всех заказов' }: { query: string; linkBase?: string; title?: string }) {
  const q = query.trim()
  const [res, setRes] = useState<{ q: string; rows: FoundOrder[]; error?: string } | null>(null)

  useEffect(() => {
    if (!q) return
    let alive = true
    const timer = setTimeout(() => {
      void loadJson<{ found: FoundOrder[] }>(`/api/b2b-orders/find?q=${encodeURIComponent(q)}`).then(r => {
        if (!alive) return
        setRes(r.error !== null ? { q, rows: [], error: r.error } : { q, rows: r.data.found })
      })
    }, 350)
    return () => { alive = false; clearTimeout(timer) }
  }, [q])

  if (!q) return null
  const now = res?.q === q ? res : null
  return (
    <div className="rounded-lg border border-[#e4e4e0] bg-white px-3 py-2.5 text-left text-[13px] space-y-1.5">
      <p className="text-[12px] font-semibold text-[#111110]">{title}</p>
      {!now && <p className="text-[#9a9a95]">Ищу…</p>}
      {now?.error && <p className="text-red-700">Поиск не ответил: {now.error}</p>}
      {now && !now.error && now.rows.length === 0 && <p className="text-[#6b6b66]">Такого заказа нет среди тех, что вам доступны.</p>}
      {now?.rows.map(f => (
        <p key={f.id} className="text-[#111110]">
          <span className="font-semibold">{f.no}</span> · {f.client ?? 'без клиента'} · от {fmtDay(f.created_day)} · <span className="font-medium">{f.status}</span>
          {linkBase && <> · <Link href={`${linkBase}/${f.id}`} className="underline text-[#6b6b66]">открыть</Link></>}
        </p>
      ))}
    </div>
  )
}
