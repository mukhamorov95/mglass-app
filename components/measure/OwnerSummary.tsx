'use client'

import { useEffect, useState } from 'react'
import type { OwnerSummary as Summary } from '@/lib/measure/ownerSummary'

// Сводка собственника: месяц одной строкой. Новые и повторные — раздельно
// (владелец 01.10). Красным — только то, что ждёт действия.
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

export default function OwnerSummary({ refreshKey }: { refreshKey: number }) {
  const [s, setS] = useState<Summary | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    fetch('/api/measure-requests/summary', { cache: 'no-store' })
      .then(async res => {
        const j = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) { setError(j.error || `Сводка не загрузилась (${res.status})`); return }
        setError(''); setS(j.summary); setTruncated(!!j.truncated)
      })
      .catch(() => { if (alive) setError('Сводка не загрузилась — нет связи') })
    return () => { alive = false }
  }, [refreshKey])

  if (error) return <p className="text-[12px] text-red-600">{error}</p>
  if (!s) return null
  const month = MONTHS[Number(s.month.slice(5, 7)) - 1]
  const share = s.paidOnsite.marked ? Math.round((s.paidOnsite.onsite / s.paidOnsite.marked) * 100) : null
  const tile = (label: string, value: string, sub?: string, alert = false) => (
    <div className={`rounded-lg border px-3 py-2 ${alert ? 'border-red-200 bg-red-50' : 'border-[#e4e4e0] bg-white'}`}>
      <p className="text-[10px] text-[#9a9a95]">{label}</p>
      <p className={`text-[16px] font-bold leading-tight ${alert ? 'text-red-700' : 'text-[#111110]'}`}>{value}</p>
      {sub && <p className="text-[10px] text-[#9a9a95]">{sub}</p>}
    </div>
  )
  return (
    <section className="space-y-1.5">
      <p className="text-[12px] font-semibold text-[#4b4b47]">👔 {month} — по всем замерщикам</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {tile('📐 Новых назначено', String(s.created.new), `выполнено ${s.done.new}`)}
        {tile('🔁 Повторных', String(s.created.repeat), `выполнено ${s.done.repeat}`)}
        {tile('🆕 Ждут замерщика', String(s.pool.count), s.pool.count ? `старшая — ${s.pool.oldestDays} дн.` : undefined, s.pool.oldestDays >= 2)}
        {tile('⚠️ Сложности', String(s.issues), s.issues ? 'ждут решения' : undefined, s.issues > 0)}
        {tile('⏰ Не отмечены', String(s.overdue), s.overdue ? 'время прошло' : undefined, s.overdue > 0)}
        {tile('💵 Оплачено на объекте', share == null ? '—' : `${share}%`, share == null ? 'оплату ещё не отмечали' : `${s.paidOnsite.onsite} из ${s.paidOnsite.marked} отмеченных`)}
        {tile('💰 Компания должна', fmt(s.owed), 'гонорар замерщикам, за всё время')}
      </div>
      {s.cancelled > 0 && <p className="text-[11px] text-[#9a9a95]">Отменено за месяц: {s.cancelled} — в «назначено» не входят.</p>}
      {truncated && <p className="text-[11px] text-amber-700">Выборка упёрлась в потолок — цифры неполные.</p>}
    </section>
  )
}
