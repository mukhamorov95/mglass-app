'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

// ДДС / платёжный календарь: прогноз остатка денег по неделям.
// Приходы: неоплаченные счета B2B (дебиторка; ожидание = дата счёта + 14 дней,
// просроченные — на ближайшую неделю) + ручные плановые приходы.
// Платежи: постоянные расходы из финмодели (1-го числа каждого месяца, Σ юнитов
// finplan_models) + ручные платежи (planned_payments).
// Остаток на счёте сегодня вводится вручную и хранится в finplan_models unit='total'.

type Manual = {
  id: number
  kind: 'in' | 'out'
  title: string
  amount: number
  due_date: string
  status: 'planned' | 'done'
}
type Flow = { date: Date; title: string; amount: number; kind: 'in' | 'out'; source: 'auto' | 'manual'; manualId?: number }

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const WEEKS = 8
const startOfWeek = (d: Date) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const day = (x.getDay() + 6) % 7 // Пн=0
  x.setDate(x.getDate() - day)
  return x
}
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const fmtDate = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
const inputCls = 'bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono text-blue-700 font-semibold outline-none focus:border-[#111110] min-w-0'

const parseNotes = (raw: unknown): Record<string, unknown> => {
  if (!raw) return {}
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return {} } }
  return raw as Record<string, unknown>
}

export default function CashflowPage() {
  const sb = createClient()
  const [loading, setLoading] = useState(true)
  const [cash, setCash] = useState(0)            // остаток на счёте сегодня
  const [fixedMonthly, setFixedMonthly] = useState(0)
  const [receivables, setReceivables] = useState<Flow[]>([])
  const [manual, setManual] = useState<Manual[]>([])
  const [meName, setMeName] = useState('')
  const [saving, setSaving] = useState(false)
  // форма нового платежа/прихода
  const [nKind, setNKind] = useState<'out' | 'in'>('out')
  const [nTitle, setNTitle] = useState('')
  const [nAmount, setNAmount] = useState('')
  const [nDate, setNDate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: p } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
      setMeName(p?.name ?? user.email ?? '')
    }
    const [{ data: fp }, { data: bo }, { data: pp }] = await Promise.all([
      sb.from('finplan_models').select('unit,data'),
      sb.from('b2b_orders')
        .select('id, custom_number, client_name, total_sale_inc_vat, total_after_discount, notes')
        .order('created_at', { ascending: false }).limit(1000),
      sb.from('planned_payments').select('*').eq('status', 'planned').order('due_date'),
    ])
    // остаток на счёте + постоянные из финмодели
    let fixed = 0
    for (const row of fp ?? []) {
      if (row.unit === 'total' && row.data?.cashBalance != null) setCash(Number(row.data.cashBalance) || 0)
      if (row.unit === 'mglass' || row.unit === 'production') {
        const fx = (row.data?.fixed ?? []) as { amount?: number }[]
        fixed += fx.reduce((s, f) => s + (Number(f.amount) || 0), 0)
      }
    }
    setFixedMonthly(fixed)
    // дебиторка → ожидаемые приходы
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const flows: Flow[] = []
    for (const o of bo ?? []) {
      const n = parseNotes(o.notes) as { status?: string; payment_status?: string; prepayment_amount?: number; stages?: Record<string, string> }
      const st = n.stages ?? {}
      if (!['confirmed', 'agreed', 'sent'].includes(n.status ?? '')) continue
      if (!st.invoice_sent || st.invoice_paid || n.payment_status === 'paid') continue
      const total = (o.total_after_discount ?? o.total_sale_inc_vat ?? 0) as number
      const debt = Math.max(0, total - (Number(n.prepayment_amount) || 0))
      if (debt <= 0) continue
      let expect = addDays(new Date(st.invoice_sent), 14)
      if (expect < today) expect = addDays(today, 3) // просроченный — ждём на этой неделе
      flows.push({ date: expect, title: `Счёт №${o.custom_number || o.id} · ${o.client_name || 'B2B'}`, amount: debt, kind: 'in', source: 'auto' })
    }
    setReceivables(flows)
    setManual((pp ?? []) as Manual[])
    setLoading(false)
  }, [sb])

  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  async function saveCash(v: number) {
    setCash(v); setSaving(true)
    try {
      const { data } = await sb.from('finplan_models').select('data').eq('unit', 'total').maybeSingle()
      await sb.from('finplan_models').upsert({
        unit: 'total', data: { ...(data?.data ?? {}), cashBalance: v },
        updated_by: meName || null, updated_at: new Date().toISOString(),
      })
    } finally { setSaving(false) }
  }

  async function addManual() {
    const amount = Number(nAmount.replace(/\s/g, '')) || 0
    if (!nTitle.trim() || amount <= 0 || !nDate) return
    await sb.from('planned_payments').insert({ kind: nKind, title: nTitle.trim(), amount, due_date: nDate, created_by: meName || null })
    setNTitle(''); setNAmount(''); setNDate('')
    await load()
  }
  async function doneManual(id: number) {
    await sb.from('planned_payments').update({ status: 'done' }).eq('id', id)
    await load()
  }
  async function deleteManual(id: number) {
    await sb.from('planned_payments').delete().eq('id', id)
    await load()
  }

  // Все потоки на горизонте WEEKS недель
  const weeks = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const w0 = startOfWeek(today)
    const flows: Flow[] = [...receivables]
    // постоянные — 1-го числа каждого месяца в горизонте
    const horizonEnd = addDays(w0, WEEKS * 7)
    const m = new Date(today.getFullYear(), today.getMonth(), 1)
    for (let i = 0; i < 4; i++) {
      const first = new Date(m.getFullYear(), m.getMonth() + i, 1)
      if (first >= today && first < horizonEnd && fixedMonthly > 0) {
        flows.push({ date: first, title: 'Постоянные расходы (план из финмодели)', amount: fixedMonthly, kind: 'out', source: 'auto' })
      }
    }
    for (const p of manual) {
      flows.push({ date: new Date(p.due_date), title: p.title, amount: Number(p.amount) || 0, kind: p.kind, source: 'manual', manualId: p.id })
    }
    let balance = cash
    return Array.from({ length: WEEKS }, (_, i) => {
      const start = addDays(w0, i * 7), end = addDays(w0, i * 7 + 7)
      // первая неделя собирает и всё просроченное/сегодняшнее
      const items = flows.filter(f => (i === 0 ? f.date < end : f.date >= start && f.date < end))
      const inflow = items.filter(f => f.kind === 'in').reduce((s, f) => s + f.amount, 0)
      const outflow = items.filter(f => f.kind === 'out').reduce((s, f) => s + f.amount, 0)
      const opening = balance
      balance = balance + inflow - outflow
      return { i, start, end: addDays(end, -1), items: items.sort((a, b) => a.date.getTime() - b.date.getTime()), inflow, outflow, opening, closing: balance }
    })
  }, [receivables, manual, fixedMonthly, cash])

  const firstGap = weeks.find(w => w.closing < 0)

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">ДДС · платёжный календарь</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Прогноз остатка на {WEEKS} недель: дебиторка как ожидаемые приходы, постоянные из финмодели + ручные платежи.</p>
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1280px]">
        {/* Вводные */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">Остаток на счетах сегодня, ₽</p>
            <input type="number" value={cash || ''} onChange={e => saveCash(Number(e.target.value) || 0)}
              className={inputCls + ' w-full mt-2 text-right text-[16px]'} placeholder="0" />
            <p className="text-[10px] text-[#c4c4be] mt-1">{saving ? 'сохраняю…' : 'сохраняется автоматически'}</p>
          </div>
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">Ожидаемые приходы (дебиторка)</p>
            <p className="text-[18px] font-bold font-mono text-emerald-700 mt-2">{fmt(receivables.reduce((s, f) => s + f.amount, 0))}</p>
            <p className="text-[10px] text-[#c4c4be] mt-1">{receivables.length} счёт(ов) · срок = дата счёта + 14 дней</p>
          </div>
          <div className={`rounded-xl p-4 border ${firstGap ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${firstGap ? 'text-red-700' : 'text-emerald-700'}`}>
              {firstGap ? '⚠ Кассовый разрыв' : 'Кассовых разрывов нет'}
            </p>
            <p className={`text-[15px] font-bold mt-2 ${firstGap ? 'text-red-700' : 'text-emerald-700'}`}>
              {firstGap ? `неделя ${fmtDate(firstGap.start)}–${fmtDate(firstGap.end)}: ${fmt(firstGap.closing)}` : `минимум за период: ${fmt(Math.min(...weeks.map(w => w.closing)))}`}
            </p>
            <p className={`text-[10px] mt-1 ${firstGap ? 'text-red-600' : 'text-emerald-600'}`}>прогноз на {WEEKS} недель при плановых постоянных {fmt(fixedMonthly)}/мес</p>
          </div>
        </div>

        {/* Недельная сетка */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-[#9a9a95] border-b border-[#f0f0ec]">
                  <th className="px-4 py-2">Неделя</th><th className="px-2 py-2 text-right">На начало</th>
                  <th className="px-2 py-2 text-right text-emerald-700">Приходы</th><th className="px-2 py-2 text-right text-red-600">Платежи</th>
                  <th className="px-2 py-2 text-right">На конец</th><th className="px-4 py-2">События</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map(w => (
                  <tr key={w.i} className={`border-b border-[#f8f8f7] align-top ${w.closing < 0 ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-2 whitespace-nowrap font-semibold">{fmtDate(w.start)} – {fmtDate(w.end)}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmt(w.opening)}</td>
                    <td className="px-2 py-2 text-right font-mono text-emerald-700">{w.inflow ? '+' + fmt(w.inflow) : '—'}</td>
                    <td className="px-2 py-2 text-right font-mono text-red-600">{w.outflow ? '−' + fmt(w.outflow) : '—'}</td>
                    <td className={`px-2 py-2 text-right font-mono font-bold ${w.closing < 0 ? 'text-red-700' : ''}`}>{fmt(w.closing)}</td>
                    <td className="px-4 py-2">
                      {w.items.length === 0 ? <span className="text-[#c4c4be]">—</span> : (
                        <div className="space-y-0.5">
                          {w.items.map((f, fi) => (
                            <div key={fi} className="flex items-center gap-1.5">
                              <span className={f.kind === 'in' ? 'text-emerald-700' : 'text-red-600'}>{f.kind === 'in' ? '↑' : '↓'}</span>
                              <span className="text-[#6b6b66]">{fmtDate(f.date)}</span>
                              <span className="truncate max-w-[280px]">{f.title}</span>
                              <span className="font-mono">{fmt(f.amount)}</span>
                              {f.manualId != null && (
                                <>
                                  <button onClick={() => doneManual(f.manualId!)} title="исполнено" className="text-emerald-600 hover:text-emerald-800 text-[11px]">✓</button>
                                  <button onClick={() => deleteManual(f.manualId!)} title="удалить" className="text-[#c4c4be] hover:text-red-500 text-[11px]">×</button>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Добавить ручной платёж/приход */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">Добавить плановый платёж / приход</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={nKind} onChange={e => setNKind(e.target.value as 'in' | 'out')}
              className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px]">
              <option value="out">↓ Платёж</option>
              <option value="in">↑ Приход</option>
            </select>
            <input value={nTitle} onChange={e => setNTitle(e.target.value)} placeholder="Назначение (аренда, поставщик, транш…)"
              className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] flex-1 min-w-[220px]" />
            <input type="number" value={nAmount} onChange={e => setNAmount(e.target.value)} placeholder="Сумма, ₽"
              className={inputCls + ' w-32 py-1.5 text-right'} />
            <input type="date" value={nDate} onChange={e => setNDate(e.target.value)}
              className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px]" />
            <button onClick={addManual}
              className="bg-[#111110] text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg hover:bg-[#2a2a28]">+ Добавить</button>
          </div>
          <p className="text-[10px] text-[#c4c4be] mt-2">Постоянные расходы подтягиваются из финмодели автоматически (1-го числа месяца) — их добавлять не нужно. Кредиторку поставщикам добавляй сюда до появления автоматической связки с закупками.</p>
        </div>
      </div>
    </div>
  )
}
