'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatPhone } from '@/lib/b2c/phoneKey'

// Список сделок B2C. Поиск по телефону и адресу (владелец: через полгода помнят
// «квартиру на Лётной», не номер). Больше ничего: блок «требуют привязки» (расчёты
// без сделки) владелец убрал — в списке нужны только сделки.

type Deal = {
  id: number; client_name: string; phone: string; phone_key: string | null; address: string
  manager_id: string | null; amo_lead_id: string | null; updated_at: string; calc_count: number
}
const date = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  async function load(search = '') {
    setLoading(true)
    try {
      const r = await fetch(`/api/deals${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Не удалось загрузить'); return }
      setDeals(j.deals ?? []); setError(null)
    } catch { setError('Сеть недоступна') } finally { setLoading(false) }
  }
  // Поиск на сервере (нормализованный телефон живёт там); дебаунс лёгкий.
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const dealList = useMemo(() => deals, [deals])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-[24px] font-bold text-[#111110]">Сделки</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">Карточка по объекту: расчёты, замер, документы, деньги в одном месте.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Поиск: телефон, адрес, клиент"
            className="border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] w-64 outline-none focus:border-[#111110] transition-colors" />
          <div className="flex bg-white border border-[#e4e4e0] rounded-xl p-0.5">
            <span className="text-[12.5px] font-medium px-3 py-1.5 rounded-[10px] bg-[#111110] text-white">Список</span>
            <Link href="/deals/board" className="text-[12.5px] font-medium px-3 py-1.5 rounded-[10px] text-[#4b4b47] hover:bg-[#f5f5f3] transition-colors">Доска</Link>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : (
        <>
          {dealList.length === 0 ? (
            <div className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-8 text-center">
              <p className="text-[14px] font-semibold text-[#111110]">{q ? 'Ничего не найдено' : 'Сделок пока нет'}</p>
              <p className="text-[12px] text-[#9a9a95] mt-1">Сделка заводится сама на первом расчёте с телефоном или адресом.</p>
            </div>
          ) : (
            <div className="bg-white border border-[#e4e4e0] rounded-2xl overflow-hidden divide-y divide-[#f0f0ec]">
              {dealList.map(d => (
                <Link key={d.id} href={`/deal/${d.id}`}
                  className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[#fafaf9] transition-colors">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#111110] truncate">
                      {d.client_name || 'Без имени'}{d.address ? ` · ${d.address}` : ''}
                    </p>
                    <p className="text-[11px] text-[#9a9a95]">
                      {d.phone ? formatPhone(d.phone) : 'телефон не указан'} · {d.calc_count} расч. · обновлено {date(d.updated_at)}
                    </p>
                  </div>
                  <span className="text-[#c4c4be]">→</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
