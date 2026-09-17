'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { shiftMonth } from '@/lib/sales/period'

// Отдел продаж — леджер продаж (замена Google-таблицы «Продажи Мгласс»).
// Менеджер видит свои продажи и свои итоги, владелец/РОП — все, и может
// смотреть месяц, квартал, год или произвольный период и оставлять на экране
// одного менеджера или нескольких. Маржа — отдельной фазой, в CFO.

type Sale = {
  id: number; lead_id: number | null; sale_date: string; ready_date: string | null; department: string
  order_no: string | null; client: string | null; amount: number; partner_fee: number; prepayment: number
  prepayment_paid: boolean; remainder_paid: boolean; payment_method: string; manager: string | null; status: string
  needs_review?: boolean
}
// paid — реально поступившие деньги (из payments), отдельно от суммы продаж:
// продажа считается полной суммой счёта, а деньги приходят частями.
type Totals = { sum: number; count: number; avg: number; paid?: number; paidLedger?: number }
type MgrRow = { manager: string; count: number; sum: number; avg: number; paid?: number }
type PeriodMode = 'month' | 'quarter' | 'year' | 'range'
type Query = { mode: PeriodMode; month: string; from: string; to: string; managers: string[] }

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const PAY = ['Счёт', 'Наличные', 'Карта', 'Перевод']
const dm = (s: string | null) => { if (!s) return '—'; const p = s.split('-'); return `${p[2]}.${p[1]}` }

const EMPTY = { sale_date: '', ready_date: '', order_no: '', client: '', amount: '', prepayment: '', payment_method: 'Счёт', partner_fee: '' }
const START: Query = { mode: 'month', month: '', from: '', to: '', managers: [] }

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [totals, setTotals] = useState<Totals>({ sum: 0, count: 0, avg: 0, paid: 0 })
  const [periodTotals, setPeriodTotals] = useState({ sum: 0, count: 0 })
  const [managers, setManagers] = useState<MgrRow[]>([])
  const [label, setLabel] = useState('')
  const [q, setQ] = useState<Query>(START)
  const [canAll, setCanAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [today, setToday] = useState('')
  const [toast, setToast] = useState('')
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2000) }

  const load = useCallback(async (next: Query) => {
    setLoading(true)
    setQ(next)
    try {
      const p = new URLSearchParams()
      if (next.mode === 'range') { if (next.from) p.set('from', next.from); if (next.to) p.set('to', next.to) }
      else { p.set('mode', next.mode); if (next.month) p.set('month', next.month) }
      if (next.managers.length) p.set('managers', next.managers.join(','))
      const r = await fetch('/api/sales?' + p.toString())
      const d = await r.json()
      if (r.ok) {
        setSales(d.sales ?? []); setTotals(d.totals); setManagers(d.managers ?? [])
        setPeriodTotals(d.periodTotals ?? { sum: 0, count: 0 })
        setLabel(d.period?.label ?? ''); setCanAll(d.canAll)
        // Месяц и даты возвращает сервер: стрелки и поля дат должны показывать
        // ровно тот период, по которому посчитаны цифры на экране.
        setQ(cur => ({ ...cur, month: d.month ?? cur.month, from: d.period?.from ?? cur.from, to: d.period?.to ?? cur.to }))
      }
    } finally { setLoading(false) }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(START) }, [load])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)) }, [])

  function toggleManager(name: string) {
    const has = q.managers.includes(name)
    load({ ...q, managers: has ? q.managers.filter(m => m !== name) : [...q.managers, name] })
  }

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
      setForm({ ...EMPTY }); setFormOpen(false); flash('Продажа добавлена'); load(q)
    } catch (e) { flash((e as Error).message) } finally { setSaving(false) }
  }
  async function patchSale(id: number, p: Record<string, unknown>) {
    await fetch('/api/sales', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...p }) })
    load(q)
  }

  const inputCls = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:border-[#111110]'
  const lbl = 'text-[11px] font-medium text-[#6b6b66] mb-1 block'
  const tile = 'bg-white border border-[#e4e4e0] rounded-xl px-4 py-3'
  const modeBtn = (m: PeriodMode) =>
    `px-3 py-1.5 rounded-lg text-[12px] font-medium border ${q.mode === m ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`
  const filtered = q.managers.length > 0

  return (
    <div className="min-h-screen bg-[#f8f8f7] pb-20">
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{toast}</div>}

      <div className="max-w-[1200px] mx-auto px-4 py-5">
        {/* Шапка */}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[18px] font-semibold text-[#111110]">💰 Реестр продаж и оплат</h1>
            {!canAll && <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f0ec] text-[#6b6b66]">только мои</span>}
            <Link href="/crm" className="text-[12px] text-[#0071e3] hover:underline">→ Воронка</Link>
          </div>
          <button onClick={() => setFormOpen(o => !o)} className="px-4 py-2 rounded-xl bg-[#111110] text-white text-[13px] font-semibold hover:opacity-90">＋ Продажа</button>
        </div>

        {/* Период: месяц стрелками, квартал, год или свои даты */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="flex items-center gap-1.5">
            <button onClick={() => load({ ...q, mode: q.mode === 'range' ? 'month' : q.mode, month: shiftMonth(q.month || '', -1) })}
              disabled={!q.month} className="w-8 h-8 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:bg-[#f5f5f3] disabled:opacity-40">‹</button>
            <span className="text-[13px] font-semibold text-[#111110] min-w-[190px] text-center">{label || '…'}</span>
            <button onClick={() => load({ ...q, mode: q.mode === 'range' ? 'month' : q.mode, month: shiftMonth(q.month || '', 1) })}
              disabled={!q.month} className="w-8 h-8 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:bg-[#f5f5f3] disabled:opacity-40">›</button>
          </div>
          <div className="flex items-center gap-1.5">
            <button className={modeBtn('month')} onClick={() => load({ ...q, mode: 'month' })}>Месяц</button>
            <button className={modeBtn('quarter')} onClick={() => load({ ...q, mode: 'quarter' })}>Квартал</button>
            <button className={modeBtn('year')} onClick={() => load({ ...q, mode: 'year' })}>Год</button>
          </div>
          <div className="flex items-center gap-1.5">
            <input type="date" value={q.from} onChange={e => setQ({ ...q, from: e.target.value })}
              className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] bg-white outline-none focus:border-[#111110]" />
            <span className="text-[12px] text-[#9a9a95]">—</span>
            <input type="date" value={q.to} onChange={e => setQ({ ...q, to: e.target.value })}
              className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] bg-white outline-none focus:border-[#111110]" />
            <button className={modeBtn('range')} onClick={() => load({ ...q, mode: 'range' })} disabled={!q.from || !q.to}>Период</button>
          </div>
        </div>

        {/* Менеджеры: все, несколько или один. Суммы в чипах — за весь период,
            поэтому видно, кого включаешь, ещё до нажатия. */}
        {canAll && managers.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <button onClick={() => load({ ...q, managers: [] })}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border ${!filtered ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
              Все менеджеры · {periodTotals.count}
            </button>
            {managers.map(m => {
              const on = q.managers.includes(m.manager)
              return (
                <button key={m.manager} onClick={() => toggleManager(m.manager)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] border ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
                  {m.manager} · {m.count} · {fmt(m.sum)}
                </button>
              )
            })}
            {filtered && (
              <span className="text-[11px] text-[#9a9a95] ml-1">
                показано {fmt(totals.sum)} из {fmt(periodTotals.sum)} за период
                {periodTotals.sum > 0 && ` (${Math.round(totals.sum / periodTotals.sum * 100)}%)`}
              </span>
            )}
          </div>
        )}

        {/* Итоги периода */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Продаж за период</p>
            <p className="text-[20px] font-bold text-[#111110] mt-0.5">{fmt(totals.sum)}</p>
            <p className="text-[11px] text-[#c4c4be] mt-0.5">{label}{filtered ? ` · ${q.managers.join(', ')}` : ''}</p>
          </div>
          <div className={tile}>
            <p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Оплачено по отметкам</p>
            <p className="text-[20px] font-bold text-emerald-700 mt-0.5">{fmt(totals.paid ?? 0)}</p>
            {totals.sum > (totals.paid ?? 0) && (
              <p className="text-[11px] text-amber-700 mt-0.5">ждём {fmt(totals.sum - (totals.paid ?? 0))}</p>
            )}
            {/* Две разные цифры: галочки предоплаты/остатка — и то, что дошло до
                платежей. У истории из книги платежей нет, и без подписи экран
                показывал «поступило 0 ₽» на оплаченный месяц. */}
            <p className="text-[11px] text-[#c4c4be] mt-0.5">
              в платежах учтено {fmt(totals.paidLedger ?? 0)}
            </p>
          </div>
          <div className={tile}><p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Количество</p><p className="text-[20px] font-bold text-[#111110] mt-0.5">{totals.count}</p></div>
          <div className={tile}><p className="text-[11px] text-[#9a9a95] uppercase tracking-wide">Средний чек</p><p className="text-[20px] font-bold text-[#111110] mt-0.5">{fmt(totals.avg)}</p></div>
        </div>

        {/* По менеджерам (кто сколько напродавал за период) */}
        {managers.length > 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 mb-4">
            <p className="text-[12px] font-semibold text-[#111110] mb-2">По менеджерам · {label}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {managers.map(m => (
                <button key={m.manager} onClick={() => toggleManager(m.manager)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left ${q.managers.includes(m.manager) ? 'bg-[#f0f0ec] border-[#111110]' : 'bg-[#fafaf9] border-[#f0f0ec] hover:border-[#e4e4e0]'}`}>
                  <span className="text-[13px] font-medium text-[#111110] truncate">{m.manager}</span>
                  <span className="text-[12px] text-[#6b6b66] shrink-0">
                    {m.count} · <b className="text-[#111110]">{fmt(m.sum)}</b> · ср. {fmt(m.avg)}
                    {m.paid != null && <> · <span className="text-emerald-700">💰 {fmt(m.paid)}</span></>}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#9a9a95] mt-2">
              Сумма по менеджерам = {fmt(managers.reduce((s, m) => s + m.sum, 0))} за период, {periodTotals.count} продаж. Нажмите на менеджера, чтобы оставить только его.
            </p>
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
                {!loading && sales.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-[#c4c4be]">
                    За {label} продаж нет{filtered ? ` у выбранных менеджеров (${q.managers.join(', ')})` : ''}. Нажми «＋ Продажа» или отметь «Продано» в карточке лида.
                  </td></tr>
                )}
                {sales.map(s => {
                  const remainder = Number(s.amount) - Number(s.prepayment)
                  return (
                    <tr key={s.id} className="border-b border-[#f0f0ec] last:border-0 hover:bg-[#fafaf9]">
                      <td className="px-3 py-2 text-[#6b6b66] whitespace-nowrap">
                        {dm(s.sale_date)}{s.ready_date ? <span className="text-[#c4c4be]"> → {dm(s.ready_date)}</span> : ''}
                        {s.needs_review && <span title="В книге не проставлена дата продажи — месяц взят по вкладке" className="ml-1 text-amber-600">⚠</span>}
                      </td>
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

        <p className="mt-3 text-[11px] text-[#c4c4be]">
          Розница M-Glass из книги «Продажи Мгласс» (2024–2026), помесячно сходится с книгой. Заказы производства (B2B) сюда не мешаются — они в CFO → «Продажи и маржа». Маржа по завершённым объектам — там же.
        </p>
      </div>
    </div>
  )
}
