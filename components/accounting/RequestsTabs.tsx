'use client'

// Б2: заявки на расходы + четверговый комитет.
// Заявка: фонд+подфонд, сумма, контрагент, способ, счёт-вложение, дата оплаты.
// Статусы: pending → approved / postponed / cancelled / paid. Заявки НИКОГДА
// не удаляются (правило владельца) — отменённые возвращаемы.
// «Оплачено» рождает операцию ДДС (cashflow_entries) и связывает её с заявкой.

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

type Fund = { id: number; unit: string; flow: string; fund_class: string; name: string; percent: number | null }
type Subfund = { id: number; fund_id: number; name: string }
type Req = {
  id: number; unit: string; fund_id: number; subfund_id: number | null
  amount: number; counterparty: string | null; method: string
  invoice_path: string | null; comment: string | null; desired_date: string | null
  status: string; status_changed_by: string | null; created_by_name: string | null; created_at: string
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'на комитет', cls: 'bg-amber-100 text-amber-800' },
  approved:  { label: 'одобрена',   cls: 'bg-blue-100 text-blue-800' },
  postponed: { label: 'перенесена', cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
  cancelled: { label: 'отменена',   cls: 'bg-red-100 text-red-700' },
  paid:      { label: 'оплачена',   cls: 'bg-emerald-100 text-emerald-800' },
}

type Shared = { unit: 'ip' | 'ooo'; funds: Fund[]; subfunds: Subfund[]; isFin: boolean; myName: string }

export function useRequests(unit: string) {
  const sb = createClient()
  const [reqs, setReqs] = useState<Req[]>([])
  const load = useCallback(async () => {
    const { data } = await sb.from('payment_requests').select('*').eq('unit', unit).order('id', { ascending: false }).limit(300)
    setReqs((data ?? []) as Req[])
  }, [sb, unit])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])
  return { reqs, reload: load }
}

// ─── Заявки: форма + список ───────────────────────────────────────────────────

export function RequestsTab({ unit, funds, subfunds, isFin, myName }: Shared) {
  const sb = createClient()
  const { reqs, reload } = useRequests(unit)
  const [fund, setFund] = useState(0)
  const [sub, setSub] = useState(0)
  const [amount, setAmount] = useState('')
  const [cp, setCp] = useState('')
  const [method, setMethod] = useState('Безнал')
  const [date, setDate] = useState('')
  const [comment, setComment] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3000) }

  const outFunds = funds.filter(f => f.unit === unit && f.fund_class !== 'income')

  async function save() {
    const amt = Number(amount.replace(/\s/g, '').replace(',', '.'))
    if (!fund || !(amt > 0)) { flash('Выбери фонд и сумму'); return }
    setSaving(true)
    const { data: { user } } = await sb.auth.getUser()
    let invoice_path: string | null = null
    if (file) {
      const path = `payment-requests/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`
      const { error: upErr } = await sb.storage.from('b2b-attachments').upload(path, file)
      if (!upErr) invoice_path = path
      else flash('Файл не загрузился — заявка сохранится без счёта')
    }
    const { error } = await sb.from('payment_requests').insert({
      unit, fund_id: fund, subfund_id: sub || null, amount: amt,
      counterparty: cp.trim() || null, method, invoice_path,
      comment: comment.trim() || null, desired_date: date || null,
      created_by: user?.id, created_by_name: myName,
    })
    setSaving(false)
    if (error) { flash('Ошибка: ' + error.message); return }
    setFund(0); setSub(0); setAmount(''); setCp(''); setComment(''); setDate(''); setFile(null)
    flash('Заявка создана — уйдёт на четверговый комитет')
    await reload()
  }

  async function setStatus(r: Req, status: string) {
    const patch: Record<string, unknown> = { status, status_changed_at: new Date().toISOString(), status_changed_by: myName, updated_at: new Date().toISOString() }
    if (status === 'paid') {
      const { data: { user } } = await sb.auth.getUser()
      const { data: entry, error: e1 } = await sb.from('cashflow_entries').insert({
        entry_date: new Date().toISOString().slice(0, 10), unit, kind: 'out',
        fund_id: r.fund_id, subfund_id: r.subfund_id, amount: r.amount,
        account: r.method === 'Наличные' ? 'Наличные касса' : null,
        counterparty: r.counterparty, comment: `Заявка #${r.id}`,
        entered_by: user?.id, entered_by_name: myName,
      }).select('id').single()
      if (e1) { flash('Операция ДДС не создалась: ' + e1.message); return }
      patch.entry_id = (entry as { id: number }).id
    }
    const { error } = await sb.from('payment_requests').update(patch).eq('id', r.id)
    if (error) { flash('Ошибка: ' + error.message); return }
    await reload()
  }

  const inputCls = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#111110] bg-white'
  const lbl = 'text-[12px] text-[#9a9a95]'

  return (
    <div className="space-y-4">
      {msg && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{msg}</div>}

      <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
        <p className="text-[13px] font-bold text-[#111110] mb-3">Новая заявка на расход</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div><span className={lbl}>Фонд *</span>
            <select value={fund} onChange={e => { setFund(Number(e.target.value)); setSub(0) }} className={inputCls}>
              <option value={0}>—</option>
              {outFunds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></div>
          <div><span className={lbl}>Подфонд</span>
            <select value={sub} onChange={e => setSub(Number(e.target.value))} className={inputCls}>
              <option value={0}>—</option>
              {subfunds.filter(s => s.fund_id === fund).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><span className={lbl}>Сумма, ₽ *</span>
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="53 245" className={inputCls} /></div>
          <div><span className={lbl}>Кому оплатить</span>
            <input value={cp} onChange={e => setCp(e.target.value)} placeholder="ООО Вандер" className={inputCls} /></div>
          <div><span className={lbl}>Способ</span>
            <select value={method} onChange={e => setMethod(e.target.value)} className={inputCls}>
              <option>Безнал</option><option>Наличные</option><option>Карта</option>
            </select></div>
          <div><span className={lbl}>Оплатить до</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} /></div>
        </div>
        <div className="flex items-end gap-3 mt-3">
          <div className="flex-1"><span className={lbl}>Комментарий</span>
            <input value={comment} onChange={e => setComment(e.target.value)} className={inputCls} /></div>
          <label className="px-3 py-2 rounded-lg border border-dashed border-[#d8d8d3] text-[13px] text-[#6b6b66] cursor-pointer whitespace-nowrap">
            {file ? `📎 ${file.name.slice(0, 18)}…` : '📎 Счёт на оплату'}
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button onClick={save} disabled={saving} className="px-5 py-2.5 rounded-lg bg-[#111110] text-white text-[14px] font-semibold disabled:opacity-50">
            {saving ? '…' : 'Создать'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
        <p className="px-4 pt-3 pb-2 text-[13px] font-semibold text-[#111110]">Заявки</p>
        {reqs.length === 0 && <p className="px-4 pb-4 text-[13px] text-[#9a9a95]">Пока пусто</p>}
        {reqs.map(r => {
          const f = funds.find(x => x.id === r.fund_id)
          const s = subfunds.find(x => x.id === r.subfund_id)
          const m = STATUS_META[r.status] ?? STATUS_META.pending
          return (
            <div key={r.id} className="px-4 py-2.5 border-t border-[#f0f0ee]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-[13px]">
                  <p className="text-[#111110]">
                    <span className="font-mono font-semibold">{RUB(Number(r.amount))}</span>
                    {r.counterparty && <> → {r.counterparty}</>}
                    <span className="text-[#9a9a95]"> · {f?.name}{s ? ` → ${s.name}` : ''}</span>
                  </p>
                  <p className="text-[12px] text-[#9a9a95] mt-0.5">
                    #{r.id} · {r.created_by_name ?? '—'} · {r.method}
                    {r.desired_date && ` · до ${r.desired_date.slice(8, 10)}.${r.desired_date.slice(5, 7)}`}
                    {r.comment && ` · ${r.comment}`}
                    {r.invoice_path && <> · <a href={`/api/payment-requests/invoice/${r.id}`} target="_blank" rel="noreferrer" className="text-blue-600">счёт ↗</a></>}
                  </p>
                </div>
                <span className={`flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>
              </div>
              {isFin && (
                <div className="flex gap-1.5 mt-1.5">
                  {r.status === 'pending' && <>
                    <button onClick={() => setStatus(r, 'approved')} className="text-[11px] px-2 py-1 rounded-md bg-blue-600 text-white">Одобрить</button>
                    <button onClick={() => setStatus(r, 'postponed')} className="text-[11px] px-2 py-1 rounded-md border border-[#e4e4e0] text-[#6b6b66]">Перенести</button>
                    <button onClick={() => setStatus(r, 'cancelled')} className="text-[11px] px-2 py-1 rounded-md border border-red-200 text-red-600">Отменить</button>
                  </>}
                  {r.status === 'approved' && <button onClick={() => setStatus(r, 'paid')} className="text-[11px] px-2 py-1 rounded-md bg-emerald-600 text-white">💸 Оплачено → в ДДС</button>}
                  {(r.status === 'postponed' || r.status === 'cancelled') &&
                    <button onClick={() => setStatus(r, 'pending')} className="text-[11px] px-2 py-1 rounded-md border border-[#e4e4e0] text-[#6b6b66]">↩ Вернуть на комитет</button>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Комитет: фонды × заявки ─────────────────────────────────────────────────

export function CommitteeTab({ unit, funds, isFin, myName }: Shared) {
  const sb = createClient()
  const { reqs, reload } = useRequests(unit)
  const [monthIncome, setMonthIncome] = useState(0)
  const [spentByFund, setSpentByFund] = useState<Map<number, number>>(new Map())

  useEffect(() => {
    const d = new Date()
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    sb.from('cashflow_entries').select('fund_id, kind, amount').eq('unit', unit).gte('entry_date', from)
      .then(({ data }) => {
        let inc = 0
        const spent = new Map<number, number>()
        for (const e of (data ?? []) as { fund_id: number; kind: string; amount: number }[]) {
          if (e.kind === 'in') inc += Number(e.amount)
          else spent.set(e.fund_id, (spent.get(e.fund_id) ?? 0) + Number(e.amount))
        }
        setMonthIncome(inc)
        setSpentByFund(spent)
      })
  }, [sb, unit])

  async function setStatus(r: Req, status: string) {
    await sb.from('payment_requests').update({ status, status_changed_at: new Date().toISOString(), status_changed_by: myName, updated_at: new Date().toISOString() }).eq('id', r.id)
    await reload()
  }

  const pending = reqs.filter(r => ['pending', 'postponed'].includes(r.status))
  const byFund = new Map<number, Req[]>()
  for (const r of pending) byFund.set(r.fund_id, [...(byFund.get(r.fund_id) ?? []), r])
  const totalAsk = pending.reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="space-y-3">
      <div className="bg-[#111110] text-white rounded-xl p-4 flex items-baseline justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">Комитет · заявок к решению</p>
          <p className="text-[22px] font-bold">{pending.length} на {RUB(totalAsk)}</p>
        </div>
        <p className="text-[12px] text-[#c9c9c4]">поступления месяца: {RUB(monthIncome)}</p>
      </div>

      {byFund.size === 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center text-[13px] text-[#9a9a95]">
          Нет заявок, ждущих решения
        </div>
      )}

      {[...byFund.entries()].map(([fundId, list]) => {
        const f = funds.find(x => x.id === fundId)
        const ask = list.reduce((s, r) => s + Number(r.amount), 0)
        // Приблизительный остаток фонда за месяц: поступления × процент − уже потрачено.
        // Точный недельный расчёт (финнеделя чт–ср, пересчёт) — этап Б3.
        const budget = f?.percent != null ? monthIncome * Number(f.percent) / 100 : null
        const spent = spentByFund.get(fundId) ?? 0
        const left = budget != null ? budget - spent : null
        const short = left != null && ask > left
        return (
          <div key={fundId} className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex items-baseline justify-between">
              <p className="text-[14px] font-semibold text-[#111110]">{f?.name}</p>
              <p className="text-[12px] font-mono">
                {left != null && <span className={short ? 'text-red-600 font-semibold' : 'text-emerald-700'}>в фонде ≈{RUB(Math.max(0, left))} · </span>}
                <span className="text-[#111110]">заявок {RUB(ask)}</span>
              </p>
            </div>
            {short && <p className="px-4 pb-1 text-[12px] text-red-600">⚠ Заявок больше, чем денег в фонде — часть перенести</p>}
            {list.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 border-t border-[#f0f0ee] text-[13px]">
                <div className="min-w-0">
                  <span className="font-mono font-semibold">{RUB(Number(r.amount))}</span>
                  {r.counterparty && <> → {r.counterparty}</>}
                  <span className="text-[#9a9a95]"> · {r.created_by_name}{r.status === 'postponed' ? ' · перенесена ранее' : ''}</span>
                  {r.invoice_path && <> · <a href={`/api/payment-requests/invoice/${r.id}`} target="_blank" rel="noreferrer" className="text-blue-600">счёт ↗</a></>}
                </div>
                {isFin && (
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => setStatus(r, 'approved')} className="text-[11px] px-2 py-1 rounded-md bg-blue-600 text-white">✓</button>
                    <button onClick={() => setStatus(r, 'postponed')} className="text-[11px] px-2 py-1 rounded-md border border-[#e4e4e0] text-[#6b6b66]">⏭</button>
                    <button onClick={() => setStatus(r, 'cancelled')} className="text-[11px] px-2 py-1 rounded-md border border-red-200 text-red-600">✕</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })}
      <p className="text-[11px] text-[#9a9a95] text-center">≈ остаток фонда — оценка по месяцу (поступления × процент − потрачено). Точная финнеделя чт–ср — следующий этап.</p>
    </div>
  )
}
