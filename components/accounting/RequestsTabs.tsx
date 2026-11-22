'use client'

// Заявки на расходы и четверговый комитет (Б2 → ФП Ф4а, docs/finplan/FINPLAN_ROUTE.md).
// Четыре суммы заявки: запрошено, одобрено, оплачено, осталось. Совет решает по
// заявкам недели в пределах свободных денег фонда; исп. директор и CFO утверждают
// директиву на сервере (/api/finplan/directive) — тогда одобренное становится
// резервом. ДДС меняется только фактом оплаты; оплат по заявке может быть несколько.
// Заявки НИКОГДА не удаляются (правило владельца).

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { finWeekOf } from '@/lib/finweek'
import { sumsOf, proposalLimits, paymentCheck, type PayLike } from '@/lib/finplan/requests'

type Fund = { id: number; unit: string; flow: string; fund_class: string; name: string; percent: number | null; sort: number }
type Subfund = { id: number; fund_id: number; name: string }
type Req = {
  id: number; unit: string; fund_id: number; subfund_id: number | null
  amount: number; approved_amount: number | null; counterparty: string | null; method: string
  invoice_path: string | null; comment: string | null; desired_date: string | null
  justification: string | null; delay_impact: string | null
  status: string; week_end: string | null; decision: string | null; decision_by: string | null
  prev_request_id: number | null; closed_at: string | null
  status_changed_by: string | null; created_by_name: string | null; created_at: string
}
type Directive = { status: 'open' | 'exec_ok' | 'final'; exec_by?: string | null; exec_at?: string | null; final_by?: string | null; final_at?: string | null }
type FundFree = { fund_id: number; available: number; reserved: number; free: number }

const RUB = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
const num = (v: string) => Number(v.replace(/\s/g, '').replace(',', '.'))
const mskToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' })
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
// Неделя, куда попадает заявка, поданная сегодня (её среда), и неделя совещания:
// в среду готовим текущую, с четверга по вторник — разбираем ту, что закончилась.
const intakeWeek = (today: string) => finWeekOf(today).end
const meetingWeek = (today: string) => (new Date(today + 'T00:00:00Z').getUTCDay() === 3 ? today : addDays(finWeekOf(today).start, -1))

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'на комитет',  cls: 'bg-amber-100 text-amber-800' },
  approved:  { label: 'одобрена',    cls: 'bg-blue-100 text-blue-800' },
  rework:    { label: 'на доработке', cls: 'bg-purple-100 text-purple-800' },
  postponed: { label: 'перенесена',  cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
  cancelled: { label: 'отменена',    cls: 'bg-red-100 text-red-700' },
  paid:      { label: 'оплачена',    cls: 'bg-emerald-100 text-emerald-800' },
}

type Shared = { unit: 'ip' | 'ooo'; funds: Fund[]; subfunds: Subfund[]; isFin: boolean; myName: string; myRole?: string }

export function useRequests(unit: string) {
  const sb = createClient()
  const [reqs, setReqs] = useState<Req[]>([])
  const [pays, setPays] = useState<PayLike[]>([])
  const [finalWeeks, setFinalWeeks] = useState<Set<string>>(new Set())
  const load = useCallback(async () => {
    const { data } = await sb.from('payment_requests').select('*').eq('unit', unit).order('id', { ascending: false }).limit(400)
    const list = (data ?? []) as Req[]
    setReqs(list)
    const ids = list.map(r => r.id)
    const [p, d] = await Promise.all([
      ids.length ? sb.from('payment_request_payments').select('request_id,amount').in('request_id', ids) : Promise.resolve({ data: [] }),
      sb.from('fp_directives').select('week_end').eq('unit', unit).eq('status', 'final'),
    ])
    setPays(((p.data ?? []) as PayLike[]).map(x => ({ ...x, amount: Number(x.amount) })))
    setFinalWeeks(new Set(((d.data ?? []) as { week_end: string }[]).map(x => x.week_end)))
  }, [sb, unit])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])
  return { reqs, pays, finalWeeks, reload: load }
}

function SumsLine({ r, pays, reserved }: { r: Req; pays: PayLike[]; reserved: boolean }) {
  const s = sumsOf({ ...r, amount: Number(r.amount), approved_amount: r.approved_amount == null ? null : Number(r.approved_amount) }, pays, reserved)
  return (
    <p className="text-[12px] text-[#4b4b47] mt-0.5 font-mono">
      запрошено {RUB(s.requested)} · одобрено {RUB(s.approved)} · оплачено {RUB(s.paid)} · осталось {RUB(s.remaining)}
      {s.reserve > 0 && <span className="text-blue-700"> · в резерве</span>}
    </p>
  )
}

// ─── Заявки: форма + список ───────────────────────────────────────────────────

export function RequestsTab({ unit, funds, subfunds, isFin, myName }: Shared) {
  const sb = createClient()
  const { reqs, pays, finalWeeks, reload } = useRequests(unit)
  const [fund, setFund] = useState(0)
  const [sub, setSub] = useState(0)
  const [amount, setAmount] = useState('')
  const [cp, setCp] = useState('')
  const [method, setMethod] = useState('Безнал')
  const [date, setDate] = useState('')
  const [comment, setComment] = useState('')
  const [why, setWhy] = useState('')
  const [impact, setImpact] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<number | null>(null)
  const [pay, setPay] = useState({ amount: '', date: '', account: '' })
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500) }

  const outFunds = funds.filter(f => f.unit === unit && f.fund_class !== 'income')

  async function save() {
    const amt = num(amount)
    if (!fund || !(amt > 0)) { flash('Выбери фонд и сумму'); return }
    if (!why.trim()) { flash('Напиши, зачем нужен расход'); return }
    setSaving(true)
    const { data: { user } } = await sb.auth.getUser()
    let invoice_path: string | null = null
    if (file) {
      const path = `payment-requests/${file.lastModified}-${file.size}-${file.name.replace(/[^\w.\-]/g, '_')}`
      const { error: upErr } = await sb.storage.from('b2b-attachments').upload(path, file)
      if (!upErr) invoice_path = path
      else flash('Файл не загрузился — заявка сохранится без счёта')
    }
    const week = intakeWeek(mskToday())
    const { data, error } = await sb.from('payment_requests').insert({
      unit, fund_id: fund, subfund_id: sub || null, amount: amt,
      counterparty: cp.trim() || null, method, invoice_path,
      comment: comment.trim() || null, desired_date: date || null,
      justification: why.trim(), delay_impact: impact.trim() || null, week_end: week,
      created_by: user?.id, created_by_name: myName,
    }).select('id')
    setSaving(false)
    if (error || !data?.length) { flash('Не сохранилось' + (error ? ': ' + error.message : ' — нет прав')); return }
    setFund(0); setSub(0); setAmount(''); setCp(''); setComment(''); setDate(''); setWhy(''); setImpact(''); setFile(null)
    flash(`Заявка создана — комитет недели до ср ${DD(week)}`)
    await reload()
  }

  async function update(r: Req, patch: Record<string, unknown>, ok: string) {
    const { data, error } = await sb.from('payment_requests')
      .update({ ...patch, status_changed_at: new Date().toISOString(), status_changed_by: myName, updated_at: new Date().toISOString() })
      .eq('id', r.id).select('id')
    if (error || !data?.length) { flash('Не сохранилось' + (error ? ': ' + error.message : ' — нет прав')); return false }
    flash(ok)
    await reload()
    return true
  }

  async function payNow(r: Req) {
    const s = sumsOf({ ...r, amount: Number(r.amount), approved_amount: r.approved_amount == null ? null : Number(r.approved_amount) }, pays, true)
    const amt = pay.amount.trim() ? num(pay.amount) : s.remaining
    if (!(amt > 0)) { flash('Сумма оплаты — больше нуля'); return }
    const chk = paymentCheck(s, amt)
    if (!chk.ok) { flash(`Больше одобренного остатка на ${RUB(chk.over)} — отправь на повторное рассмотрение`); return }
    const day = pay.date || mskToday()
    const { data: { user } } = await sb.auth.getUser()
    const account = pay.account.trim() || (r.method === 'Наличные' ? 'Наличные касса' : null)
    const { data: entry, error: e1 } = await sb.from('cashflow_entries').insert({
      entry_date: day, unit, kind: 'out', fund_id: r.fund_id, subfund_id: r.subfund_id, amount: amt,
      account, counterparty: r.counterparty, comment: `Заявка #${r.id}`,
      entered_by: user?.id, entered_by_name: myName,
    }).select('id').single()
    if (e1 || !entry) { flash('Операция ДДС не создалась' + (e1 ? ': ' + e1.message : '')); return }
    const entryId = (entry as { id: number }).id
    const { error: e2 } = await sb.from('payment_request_payments').insert({
      request_id: r.id, entry_id: entryId, amount: amt, paid_on: day, account, paid_by_name: myName,
    })
    if (e2) { flash(`Расход в ДДС записан (операция ${entryId}), но к заявке не привязан: ${e2.message}`); await reload(); return }
    await update(r, { entry_id: entryId, ...(chk.closes ? { status: 'paid' } : {}) }, chk.closes ? 'Оплачено полностью ✓' : 'Оплата записана — остаток ждёт ✓')
    setPayFor(null); setPay({ amount: '', date: '', account: '' })
  }

  async function reReview(r: Req) {
    const s = sumsOf({ ...r, amount: Number(r.amount), approved_amount: r.approved_amount == null ? null : Number(r.approved_amount) }, pays, true)
    const extra = num(pay.amount) - s.remaining
    if (!(extra > 0)) { flash('Новая сумма оплаты не больше остатка — повторное рассмотрение не нужно'); return }
    const total = Math.round((s.approved + extra) * 100) / 100
    await update(r, {
      amount: total, status: 'pending', decision: null, decision_by: null, decision_at: null,
      week_end: intakeWeek(mskToday()) === r.week_end ? addDays(intakeWeek(mskToday()), 7) : intakeWeek(mskToday()),
      comment: [r.comment, `цена выросла до ${RUB(total)}, было одобрено ${RUB(s.approved)}`].filter(Boolean).join(' · '),
    }, 'Заявка ушла на повторное рассмотрение')
    setPayFor(null)
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
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div><span className={lbl}>Зачем нужен расход *</span>
            <input value={why} onChange={e => setWhy(e.target.value)} className={inputCls} /></div>
          <div><span className={lbl}>Что будет, если отложить</span>
            <input value={impact} onChange={e => setImpact(e.target.value)} className={inputCls} /></div>
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
          const reserved = !!r.week_end && finalWeeks.has(r.week_end)
          const sums = sumsOf({ ...r, amount: Number(r.amount), approved_amount: r.approved_amount == null ? null : Number(r.approved_amount) }, pays, reserved)
          return (
            <div key={r.id} className="px-4 py-2.5 border-t border-[#f0f0ee]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-[13px]">
                  <p className="text-[#111110]">
                    <span className="font-mono font-semibold">{RUB(Number(r.amount))}</span>
                    {r.counterparty && <> → {r.counterparty}</>}
                    <span className="text-[#9a9a95]"> · {f?.name}{s ? ` → ${s.name}` : ''}</span>
                  </p>
                  <SumsLine r={r} pays={pays} reserved={reserved} />
                  <p className="text-[12px] text-[#9a9a95] mt-0.5">
                    #{r.id} · {r.created_by_name ?? '—'} · {r.method}
                    {r.week_end && ` · неделя до ср ${DD(r.week_end)}${reserved ? ' (утверждена)' : ''}`}
                    {r.desired_date && ` · оплатить до ${DD(r.desired_date)}`}
                    {r.decision_by && ` · решение: ${r.decision_by}`}
                    {r.prev_request_id && ` · перенос заявки #${r.prev_request_id}`}
                    {r.closed_at && ' · закрыта'}
                    {r.invoice_path && <> · <a href={`/api/payment-requests/invoice/${r.id}`} target="_blank" rel="noreferrer" className="text-blue-600">счёт ↗</a></>}
                  </p>
                  {(r.justification || r.delay_impact || r.comment) && (
                    <p className="text-[12px] text-[#6b6b66] mt-0.5">
                      {r.justification}{r.delay_impact && ` · если отложить: ${r.delay_impact}`}{r.comment && ` · ${r.comment}`}
                    </p>
                  )}
                </div>
                <span className={`flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>
              </div>
              {isFin && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {r.status === 'approved' && !r.closed_at && reserved && payFor !== r.id &&
                    <button onClick={() => { setPayFor(r.id); setPay({ amount: String(sums.remaining), date: '', account: '' }) }} className="text-[11px] px-2 py-1 rounded-md bg-emerald-600 text-white">💸 Оплатить</button>}
                  {r.status === 'approved' && !reserved && <span className="text-[11px] text-[#9a9a95]">оплата — после утверждения директивы недели</span>}
                  {r.status === 'approved' && sums.paid > 0 && sums.remaining > 0 && !r.closed_at &&
                    <button onClick={() => update(r, { closed_at: new Date().toISOString(), closed_by: myName, status: 'paid' }, `Закрыта — резерв ${RUB(sums.remaining)} освобождён`)}
                      className="text-[11px] px-2 py-1 rounded-md border border-[#e4e4e0] text-[#6b6b66]">Закрыть: цена ниже</button>}
                  {(r.status === 'rework' || r.status === 'cancelled') &&
                    <button onClick={() => update(r, { status: 'pending', decision: null, week_end: intakeWeek(mskToday()) }, 'Вернулась на комитет')} className="text-[11px] px-2 py-1 rounded-md border border-[#e4e4e0] text-[#6b6b66]">↩ На комитет</button>}
                  {r.status === 'pending' &&
                    <button onClick={() => update(r, { status: 'cancelled' }, 'Отменена')} className="text-[11px] px-2 py-1 rounded-md border border-red-200 text-red-600">Отменить</button>}
                </div>
              )}
              {payFor === r.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} inputMode="decimal" className="w-[130px] border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px] font-mono" />
                  <input type="date" value={pay.date || mskToday()} onChange={e => setPay({ ...pay, date: e.target.value })} className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px]" />
                  <input value={pay.account} onChange={e => setPay({ ...pay, account: e.target.value })} placeholder="счёт / касса" className="w-[140px] border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px]" />
                  <button onClick={() => payNow(r)} className="text-[12px] px-3 py-1 rounded-md bg-emerald-600 text-white">Записать оплату</button>
                  {num(pay.amount) > sums.remaining &&
                    <button onClick={() => reReview(r)} className="text-[12px] px-3 py-1 rounded-md border border-amber-300 text-amber-800">Цена выросла → на повторное рассмотрение</button>}
                  <button onClick={() => setPayFor(null)} className="text-[12px] text-[#9a9a95]">отмена</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Комитет: неделя → фонды → заявки, директива ─────────────────────────────

export function CommitteeTab({ unit, funds, isFin, myName, myRole }: Shared) {
  const sb = createClient()
  const { reqs, pays, reload } = useRequests(unit)
  const [week, setWeek] = useState('')
  const [dir, setDir] = useState<Directive>({ status: 'open' })
  const [free, setFree] = useState<FundFree[]>([])
  const [draft, setDraft] = useState<Record<number, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWeek(meetingWeek(mskToday()))
  }, [])

  const loadDir = useCallback(async () => {
    if (!week) return
    const res = await fetch(`/api/finplan/directive?unit=${unit}&week_end=${week}`)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { flash('Свободные деньги не посчитаны: ' + (d.error ?? res.status)); return }
    setDir(d.directive as Directive)
    setFree(d.free as FundFree[])
  }, [unit, week])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadDir() }, [loadDir])

  const final = dir.status === 'final'
  const weekReqs = useMemo(() => reqs.filter(r => r.week_end === week && ['pending', 'approved', 'rework', 'postponed'].includes(r.status)), [reqs, week])
  const byFund = useMemo(() => {
    const m = new Map<number, Req[]>()
    for (const r of [...weekReqs].sort((a, b) => a.id - b.id)) m.set(r.fund_id, [...(m.get(r.fund_id) ?? []), r])
    return m
  }, [weekReqs])
  const freeBy = useMemo(() => new Map(free.map(f => [f.fund_id, f])), [free])
  const totalAsk = weekReqs.filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0)

  async function decide(r: Req, patch: Record<string, unknown>, ok: string) {
    const { data, error } = await sb.from('payment_requests')
      .update({ ...patch, decision_by: myName, decision_at: new Date().toISOString(), status_changed_at: new Date().toISOString(), status_changed_by: myName, updated_at: new Date().toISOString() })
      .eq('id', r.id).select('id')
    if (error || !data?.length) { flash('Не сохранилось' + (error ? ': ' + error.message : ' — нет прав')); return }
    flash(ok)
    await reload()
  }

  async function postpone(r: Req) {
    const next = addDays(week, 7)
    const { data: { user } } = await sb.auth.getUser()
    const { data, error } = await sb.from('payment_requests').insert({
      unit, fund_id: r.fund_id, subfund_id: r.subfund_id, amount: r.amount, counterparty: r.counterparty, method: r.method,
      invoice_path: r.invoice_path, comment: r.comment, desired_date: r.desired_date, justification: r.justification,
      delay_impact: r.delay_impact, week_end: next, prev_request_id: r.id, created_by: user?.id, created_by_name: r.created_by_name,
    }).select('id')
    if (error || !data?.length) { flash('Перенос не создан' + (error ? ': ' + error.message : '')); return }
    await decide(r, { status: 'postponed', decision: 'postpone' }, `Перенесена на неделю до ср ${DD(next)} (заявка #${(data[0] as { id: number }).id})`)
  }

  async function sign(action: 'exec' | 'final') {
    const res = await fetch('/api/finplan/directive', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unit, week_end: week, action }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      const sh = (d.shortages ?? []) as { fund_id: number; over: number }[]
      flash((d.error ?? 'Не утверждено') + (sh.length ? ': ' + sh.map(s => `${funds.find(f => f.id === s.fund_id)?.name} — сверх на ${RUB(s.over)}`).join('; ') : ''))
      return
    }
    flash(action === 'exec' ? 'План недели утверждён исп. директором ✓' : d.already ? 'Директива уже утверждена' : 'Директива утверждена — деньги зарезервированы ✓')
    await Promise.all([loadDir(), reload()])
  }

  const canExec = ['ceo', 'admin'].includes(myRole ?? '')
  const canFinal = ['cfo', 'admin'].includes(myRole ?? '')

  return (
    <div className="space-y-3">
      {msg && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white max-w-[90vw]">{msg}</div>}

      <div className="flex items-center gap-2">
        <button onClick={() => setWeek(addDays(week, -7))} className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[13px]">←</button>
        <span className="text-[14px] font-semibold text-[#111110] min-w-[170px] text-center">{week && `неделя чт ${DD(addDays(week, -6))} — ср ${DD(week)}`}</span>
        <button onClick={() => setWeek(addDays(week, 7))} className="px-2.5 py-1 rounded-md border border-[#e4e4e0] text-[13px]">→</button>
      </div>

      <div className="bg-[#111110] text-white rounded-xl p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-[#9a9a95]">Комитет · ждут решения</p>
            <p className="text-[22px] font-bold">{weekReqs.filter(r => r.status === 'pending').length} на {RUB(totalAsk)}</p>
          </div>
          <p className="text-[12px] text-[#c9c9c4]">
            {dir.status === 'open' && 'директива не утверждена'}
            {dir.status === 'exec_ok' && `исп. директор: ${dir.exec_by ?? '—'} · ждёт CFO`}
            {final && `утверждена: ${dir.final_by ?? '—'}${dir.final_at ? ' · ' + new Date(dir.final_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : ''}`}
          </p>
        </div>
        {!final && (canExec || canFinal) && (
          <div className="flex gap-2 mt-3">
            {canExec && dir.status === 'open' && <button onClick={() => sign('exec')} className="px-3 py-1.5 rounded-lg bg-white text-[#111110] text-[12px] font-semibold">Утвердить план недели (исп. директор)</button>}
            {canFinal && dir.status === 'exec_ok' && <button onClick={() => sign('final')} className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[12px] font-semibold">Утвердить директиву (CFO)</button>}
          </div>
        )}
      </div>

      {byFund.size === 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center text-[13px] text-[#9a9a95]">Заявок этой недели нет</div>
      )}

      {[...byFund.entries()].map(([fundId, list]) => {
        const f = funds.find(x => x.id === fundId)
        const ff = freeBy.get(fundId)
        const approvedHere = list.filter(r => r.status === 'approved').reduce((s, r) => s + Number(r.approved_amount ?? r.amount), 0)
        const left = ff ? Math.round((ff.free - approvedHere) * 100) / 100 : null
        const pending = list.filter(r => r.status === 'pending')
        const limits = new Map(proposalLimits(left ?? Number.MAX_SAFE_INTEGER, pending.map(r => ({ id: r.id, amount: Number(r.amount) }))).map(l => [l.id, l]))
        return (
          <div key={fundId} className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
            <div className="px-4 pt-3 pb-2">
              <p className="text-[14px] font-semibold text-[#111110]">{f?.name}</p>
              {ff ? (
                <p className="text-[12px] font-mono text-[#4b4b47]">
                  в фонде {RUB(ff.available)} · в резерве {RUB(ff.reserved)} · одобрено на неделе {RUB(approvedHere)} ·{' '}
                  <span className={left != null && left < 0 ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>свободно {RUB(left ?? 0)}</span>
                </p>
              ) : <p className="text-[12px] text-[#9a9a95]">у фонда нет % в модели — свободные деньги не считаются</p>}
            </div>
            {list.map(r => {
              const lim = limits.get(r.id)
              const val = draft[r.id] ?? (lim ? String(lim.max) : String(r.amount))
              const m = STATUS_META[r.status] ?? STATUS_META.pending
              return (
                <div key={r.id} className="px-4 py-2 border-t border-[#f0f0ee] text-[13px]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-mono font-semibold">{RUB(Number(r.amount))}</span>
                      {r.counterparty && <> → {r.counterparty}</>}
                      <span className="text-[#9a9a95]"> · #{r.id} · {r.created_by_name}{r.prev_request_id ? ` · перенос #${r.prev_request_id}` : ''}</span>
                      {r.invoice_path && <> · <a href={`/api/payment-requests/invoice/${r.id}`} target="_blank" rel="noreferrer" className="text-blue-600">счёт ↗</a></>}
                      {(r.justification || r.delay_impact) && <p className="text-[12px] text-[#6b6b66]">{r.justification}{r.delay_impact && ` · если отложить: ${r.delay_impact}`}</p>}
                      {r.status !== 'pending' && <SumsLine r={r} pays={pays} reserved={final} />}
                      {lim && lim.short > 0 && <p className="text-[12px] text-red-600">денег фонда хватает на {RUB(lim.max)} из {RUB(lim.asked)}</p>}
                    </div>
                    <span className={`flex-shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>
                  </div>
                  {isFin && !final && r.status === 'pending' && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <input value={val} onChange={e => setDraft({ ...draft, [r.id]: e.target.value })} inputMode="decimal"
                        className="w-[120px] border border-[#e4e4e0] rounded-md px-2 py-1 text-[12px] font-mono" />
                      <button onClick={() => {
                        const a = num(val)
                        if (!(a > 0) || a > Number(r.amount)) { flash('Одобрить можно от 0 до запрошенного'); return }
                        if (lim && a > lim.max) { flash(`В фонде свободно только ${RUB(lim.max)} для этой заявки`); return }
                        decide(r, { status: 'approved', approved_amount: a, decision: a === Number(r.amount) ? 'full' : 'partial' }, 'Одобрено ✓')
                      }} className="text-[11px] px-2 py-1 rounded-md bg-blue-600 text-white">Одобрить</button>
                      <button onClick={() => decide(r, { status: 'rework', decision: 'rework' }, 'На доработку')} className="text-[11px] px-2 py-1 rounded-md border border-[#e4e4e0] text-[#6b6b66]">На доработку</button>
                      <button onClick={() => postpone(r)} className="text-[11px] px-2 py-1 rounded-md border border-[#e4e4e0] text-[#6b6b66]">Перенести</button>
                    </div>
                  )}
                  {isFin && !final && r.status === 'approved' && (
                    <button onClick={() => decide(r, { status: 'pending', approved_amount: null, decision: null }, 'Решение снято')} className="mt-1.5 text-[11px] px-2 py-1 rounded-md border border-[#e4e4e0] text-[#6b6b66]">↩ Снять решение</button>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
      <p className="text-[11px] text-[#9a9a95] text-center">
        Свободно = остаток фонда по финнеделям месяца (заливка денег клиентов − расходы) − резервы утверждённых недель − одобренное на этой неделе.
        Окончательное утверждение сервер проверяет заново и не пропускает одобренное сверх свободного.
      </p>
    </div>
  )
}
