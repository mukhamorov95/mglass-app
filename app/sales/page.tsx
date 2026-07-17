'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

// Отдел продаж — леджер продаж по месяцам (замена Google-таблицы «Продажи»).
// Менеджер видит свои продажи и свои итоги, владелец/РОП — все. Маржа — отдельной
// фазой. Продажа попадает сюда кнопкой «Продано» из карточки лида или вручную.

type Sale = {
  id: number; lead_id: number | null; sale_date: string; ready_date: string | null; department: string
  order_no: string | null; client: string | null; amount: number; partner_fee: number; prepayment: number
  prepayment_paid: boolean; remainder_paid: boolean; payment_method: string; manager: string | null; status: string
}
type Totals = { sum: number; count: number; avg: number }
type MgrRow = { manager: string; count: number; sum: number; avg: number }

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const PAY = ['Счёт', 'Наличные', 'Карта', 'Перевод']
const dm = (s: string | null) => { if (!s) return '—'; const p = s.split('-'); return `${p[2]}.${p[1]}` }
function shiftMonth(ym: string, d: number) { const [y, m] = ym.split('-').map(Number); let mo = m + d, yy = y; while (mo < 1) { mo += 12; yy-- } while (mo > 12) { mo -= 12; yy++ } return `${yy}-${String(mo).padStart(2, '0')}` }
function monthLabel(ym: string) { if (!ym) return ''; const [y, m] = ym.split('-').map(Number); return `${MONTHS[(m || 1) - 1]} ${y}` }

const EMPTY = { sale_date: '', ready_date: '', order_no: '', client: '', amount: '', prepayment: '', payment_method: 'Счёт', partner_fee: '' }

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [totals, setTotals] = useState<Totals>({ sum: 0, count: 0, avg: 0 })
  const [managers, setManagers] = useState<MgrRow[]>([])
  const [month, setMonth] = useState('')
  const [canAll, setCanAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [today, setToday] = useState('')
  const [toast, setToast] = useState('')
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2000) }

  const load = useCallback(async (m?: string) => {
    setLoading(true)
    try {
      const r = await fetch('/api/sales' + (m ? `?month=${m}` : ''))
      const d = await r.json()
      if (r.ok) { setSales(d.sales ?? []); setTotals(d.totals); setManagers(d.managers ?? []); setMonth(d.month); setCanAll(d.canAll) }
    } finally { setLoading(false) }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)) }, [])

  async function addSale() {
    if (!form.amount || Number(form.amount) <= 0) { flash('Укажите сумму'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sale_date: form.sale_date || today, ready_date: form.ready_date || null, order_no: form.order_no, client: form.client,
          amount: Number(form.amount), prepayment: Number(form.prepayment) || 0, partner_fee: Number(form.partner_fee) || 0, payment_method: form.payment_method,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      setForm({ ...EMPTY }); setFormOpen(false); flash('Продажа добавлена'); load(month)
    } catch (e) { flash((e as Error).message) } finally { setSaving(false) }
  }
  async function patchSale(id: number, p: Record<string, unknown>) {
    await fetch('/api/sales', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...p }) })
    load(month)
  }

  const inputCls = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:border-[#111110]'
  const lbl = 'text-[11px] font-medium text-[#6b6b66] mb-1 block'
  const tile = 'bg-white border border-[#e4e4e0] rounded-xl px-4 py-3'

  return (
    <div className="min-h-screen bg-[#f8f8f7] pb-20">
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{toast}</div>}

      <div className="max-w-[1200px] mx-auto px-4 py-5">
        {/* Шапка + переключатель месяца */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-[18px] font-semibold text-[#111110]">💰 Отдел продаж</h1>
            {!canAll && <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f0ec] text-[#6b6b66]">только мои</span>}
            <Link href="/crm" className="text-[12px] text-[#0071e3] hover:underline">→ Воронка</Link>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => load(shiftMonth(month, -1))} disabled={!month} className="w-8 h-8 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:bg-[#f5f5f3]">‹</button>
            <span className="text-[13px] font-semibold text-[#111110] w-32 text-center">{monthLabel(month)}</span>
            <button onClick={() => load(shiftMonth(month, 1))} disabled={!month} className="w-8 h-8 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:bg-[#f5f5f3]">›</button>
            <button onClick={() => setFormOpen(o => !o)} className="ml-1 px-4 py-2 rounded-xl bg-[#111110] text-white text-[13px] font-semibold hover:opacity-90">＋ Продажа</button>
          </div>
        </div>

        {/* Итоги месяца */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className={tile}><p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Продаж за месяц</p><p className="text-[20px] font-bold text-[#111110] mt-0.5">{fmt(totals.sum)}</p></div>
          <div className={tile}><p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Количество</p><p className="text-[20px] font-bold text-[#111110] mt-0.5">{totals.count}</p></div>
          <div className={tile}><p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Средний чек</p><p className="text-[20px] font-bold text-[#111110] mt-0.5">{fmt(totals.avg)}</p></div>
        </div>

        {/* По менеджерам (кто сколько напродавал) */}
        {managers.length > 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 mb-4">
            <p className="text-[12px] font-semibold text-[#111110] mb-2">По менеджерам</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {managers.map(m => (
                <div key={m.manager} className="flex items-center justify-between rounded-lg bg-[#fafaf9] border border-[#f0f0ec] px-3 py-2">
                  <span className="text-[13px] font-medium text-[#111110] truncate">{m.manager}</span>
                  <span className="text-[12px] text-[#6b6b66] shrink-0">{m.count} · <b className="text-[#111110]">{fmt(m.sum)}</b> · ср. {fmt(m.avg)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Форма добавления продажи */}
        {formOpen && (
          <div className="bg-white rounded-xl border border-[#111110] p-4 mb-4">
            <p className="text-[13px] font-bold text-[#111110] mb-3">Новая продажа</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div><span className={lbl}>Дата продажи</span><input type="date" className={inputCls} value={form.sale_date || today} onChange={e => setForm({ ...form, sale_date: e.target.value })} /></div>
              <div><span className={lbl}>Дата готовности</span><input type="date" className={inputCls} value={form.ready_date} onChange={e => setForm({ ...form, ready_date: e.target.value })} /></div>
              <div><span className={lbl}>№ заказа</span><input className={inputCls} value={form.order_no} onChange={e => setForm({ ...form, order_no: e.target.value })} placeholder="0000-0" /></div>
              <div><span className={lbl}>Клиент</span><input className={inputCls} value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-2.5">
              <div><span className={lbl}>Сумма, ₽ *</span><input type="number" className={inputCls} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="почём продал" /></div>
              <div><span className={lbl}>Предоплата, ₽</span><input type="number" className={inputCls} value={form.prepayment} onChange={e => setForm({ ...form, prepayment: e.target.value })} /></div>
              <div><span className={lbl}>Партнёрские, ₽</span><input type="number" className={inputCls} value={form.partner_fee} onChange={e => setForm({ ...form, partner_fee: e.target.value })} /></div>
              <div><span className={lbl}>Оплата</span>
                <select className={inputCls} value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })}>
                  {PAY.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={addSale} disabled={saving} className="px-5 py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-50">{saving ? 'Сохраняю…' : 'Добавить'}</button>
              <button onClick={() => setFormOpen(false)} className="px-4 py-2.5 rounded-xl border border-[#e4e4e0] text-[13px] text-[#6b6b66]">Отмена</button>
            </div>
          </div>
        )}

        {/* Леджер продаж */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="bg-[#f7f7f5] border-b border-[#e4e4e0] text-[#9a9a95] text-[11px] uppercase">
                  <th className="text-left font-medium px-3 py-2">Дата</th>
                  <th className="text-left font-medium px-3 py-2">№ заказа</th>
                  <th className="text-left font-medium px-3 py-2">Клиент</th>
                  <th className="text-right font-medium px-3 py-2">Сумма</th>
                  <th className="text-center font-medium px-3 py-2">Оплата</th>
                  <th className="text-right font-medium px-3 py-2">Предоплата</th>
                  <th className="text-right font-medium px-3 py-2">Остаток</th>
                  {canAll && <th className="text-left font-medium px-3 py-2">Менеджер</th>}
                  <th className="text-center font-medium px-3 py-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-[#9a9a95]">Загрузка…</td></tr>}
                {!loading && sales.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-[#c4c4be]">За {monthLabel(month)} продаж нет. Нажми «＋ Продажа» или отметь «Продано» в карточке лида.</td></tr>}
                {sales.map(s => {
                  const remainder = Number(s.amount) - Number(s.prepayment)
                  return (
                    <tr key={s.id} className="border-b border-[#f0f0ec] last:border-0 hover:bg-[#fafaf9]">
                      <td className="px-3 py-2 text-[#6b6b66] whitespace-nowrap">{dm(s.sale_date)}{s.ready_date ? <span className="text-[#c4c4be]"> → {dm(s.ready_date)}</span> : ''}</td>
                      <td className="px-3 py-2 text-[#111110] whitespace-nowrap">{s.lead_id ? <Link href={`/crm/${s.lead_id}`} className="text-[#0071e3] hover:underline">{s.order_no || `#${s.id}`}</Link> : (s.order_no || `#${s.id}`)}</td>
                      <td className="px-3 py-2 text-[#111110] max-w-[220px] truncate">{s.client || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">{fmt(Number(s.amount))}</td>
                      <td className="px-3 py-2 text-center text-[#6b6b66] whitespace-nowrap">{s.payment_method}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => patchSale(s.id, { prepayment_paid: !s.prepayment_paid })} title="Отметить оплату предоплаты"
                          className={`font-mono ${s.prepayment_paid ? 'text-emerald-600' : 'text-[#9a9a95]'}`}>
                          {s.prepayment_paid ? '✓ ' : '○ '}{fmt(Number(s.prepayment))}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => patchSale(s.id, { remainder_paid: !s.remainder_paid })} title="Отметить оплату остатка"
                          className={`font-mono ${s.remainder_paid ? 'text-emerald-600' : 'text-[#9a9a95]'}`}>
                          {s.remainder_paid ? '✓ ' : '○ '}{fmt(remainder)}
                        </button>
                      </td>
                      {canAll && <td className="px-3 py-2 text-[#6b6b66] whitespace-nowrap">{s.manager || '—'}</td>}
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        <button onClick={() => patchSale(s.id, { status: s.status === 'closed' ? 'open' : 'closed' })}
                          className={`text-[11px] px-2 py-1 rounded-md font-medium ${s.status === 'closed' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-500'}`}>
                          {s.status === 'closed' ? 'Закрыт' : 'Не закрыт'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-[#c4c4be]">Маржа по завершённым объектам подключается отдельной фазой. История до запуска — в Google-таблице.</p>
      </div>
    </div>
  )
}
