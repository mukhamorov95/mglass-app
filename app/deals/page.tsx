'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatPhone, phoneKey } from '@/lib/b2c/phoneKey'

// Список сделок B2C. Поиск по телефону и адресу (владелец: через полгода помнят
// «квартиру на Лётной», не номер). Плюс блок «требуют привязки» — сохранённые
// расчёты без сделки, чтобы они были видны и привязывались руками, а не терялись.

type Deal = {
  id: number; client_name: string; phone: string; phone_key: string | null; address: string
  manager_id: string | null; amo_lead_id: string | null; updated_at: string; calc_count: number
}
type Orphan = {
  id: number; product_type: string; final_price: number; created_at: string
  client_name: string | null; client_phone: string | null
}

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const date = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [orphans, setOrphans] = useState<Orphan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<number | null>(null)

  async function load(search = '') {
    setLoading(true)
    try {
      const r = await fetch(`/api/deals${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Не удалось загрузить'); return }
      setDeals(j.deals ?? []); setOrphans(j.orphans ?? []); setError(null)
    } catch { setError('Сеть недоступна') } finally { setLoading(false) }
  }
  // Поиск на сервере (нормализованный телефон живёт там); дебаунс лёгкий.
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  async function createDealFromOrphan(o: Orphan) {
    setBusy(o.id)
    try {
      const r = await fetch('/api/deals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: o.client_name ?? '', phone: o.client_phone ?? '', calc_id: o.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.id) { window.location.assign(`/deal/${j.id}`) }
    } finally { setBusy(null) }
  }

  // Привязать осиротевший расчёт к существующей сделке (кейс «телефон совпал» —
  // человек решает: этот объект или новый). Склейка только через явный выбор.
  async function attachOrphan(o: Orphan, dealId: number) {
    setBusy(o.id)
    try {
      const r = await fetch(`/api/deals/${dealId}/attach`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calc_id: o.id }),
      })
      if (r.ok) await load(q.trim())
    } finally { setBusy(null) }
  }

  // Кандидаты для привязки — сделки с тем же телефоном (по нормализованному ключу).
  // Это и есть неоднозначность «сюда или новый объект», решаемая одним нажатием.
  function candidatesFor(o: Orphan): Deal[] {
    const pk = phoneKey(o.client_phone)
    if (!pk) return []
    return deals.filter(d => d.phone_key === pk)
  }

  const hasOrphans = orphans.length > 0
  const dealList = useMemo(() => deals, [deals])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-[24px] font-bold text-[#111110]">Сделки</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">Карточка по объекту: расчёты, замер, документы, деньги в одном месте.</p>
        </div>
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="Поиск: телефон, адрес, клиент"
          className="border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] w-72 outline-none focus:border-[#111110] transition-colors" />
      </div>

      {loading ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : (
        <>
          {hasOrphans && (
            <div className="mb-5 border border-amber-200 bg-amber-50/50 rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-amber-200">
                <p className="text-[12px] font-semibold text-amber-800">Требуют привязки — {orphans.length}</p>
                <p className="text-[11px] text-amber-700">Расчёты с клиентом, но без сделки. Заведите по ним объект.</p>
              </div>
              <div className="divide-y divide-amber-100">
                {orphans.map(o => {
                  const cands = candidatesFor(o)
                  return (
                    <div key={o.id} className="px-4 py-2.5 flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-[13px] text-[#111110] truncate">
                          {o.client_name || '—'}{o.client_phone ? ` · ${formatPhone(o.client_phone)}` : ''}
                        </p>
                        <p className="text-[11px] text-[#9a9a95]">{date(o.created_at)} · {fmt(Number(o.final_price) || 0)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {/* Телефон совпал с существующей сделкой → предлагаем привязать
                            туда; человек решает объект. Плюс всегда «Новый объект». */}
                        {cands.map(c => (
                          <button key={c.id} onClick={() => attachOrphan(o, c.id)} disabled={busy === o.id}
                            title={`Привязать к сделке ${c.address || c.client_name}`}
                            className="text-[12px] px-2.5 py-1.5 rounded-lg border border-[#c9d4f0] bg-white text-[#111110] hover:bg-[#f0f4ff] disabled:opacity-40 whitespace-nowrap max-w-[180px] truncate">
                            → {c.address || c.client_name || `сделка #${c.id}`}
                          </button>
                        ))}
                        <button onClick={() => createDealFromOrphan(o)} disabled={busy === o.id}
                          className="text-[12px] font-medium px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 whitespace-nowrap">
                          {busy === o.id ? '…' : cands.length ? 'Новый объект' : 'Завести сделку'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

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
