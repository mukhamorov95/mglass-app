'use client'

import { useCallback, useEffect, useState } from 'react'
import { confirmDialog } from '@/lib/dialog'
import { mskToday, sendMeasure } from '@/lib/measure/client'
import { PAYMENT_LABEL, companyOwes, finalPrice, type EarningsSummary, type VisitPayment } from '@/lib/measure/money'
import SettleForm, { type SettleRow } from '@/components/measure/SettleForm'

// «Заработок» замерщика за период: сколько сделано и на какую сумму, как оплачены
// выезды (на объекте / на компанию / не оплачено), гонорар и сколько должна компания.
// Видят сам замерщик и владелец. Итоги считает сервер (summarizeEarnings), и они
// сходятся: сделано = на объекте + на компанию + не оплачено + не отмечено.

type Row = SettleRow & {
  client_name: string
  address: string | null
  scheduled_at: string
  status: string
  measurer_id: string | null
  measurer_name: string | null
  manager_name: string | null
  measurer_fee: number
  fee_status: string
}
type Data = {
  from: string
  to: string
  canPickMeasurer: boolean
  truncated: boolean
  measurers: { id: string; name: string }[]
  summary: EarningsSummary
  rows: Row[]
}

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const ddmm = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' })
const PAY_TONE: Record<VisitPayment, string> = {
  onsite: 'bg-emerald-50 text-emerald-700', company: 'bg-blue-50 text-blue-700', unpaid: 'bg-red-50 text-red-700',
}

function period(kind: 'month' | 'prev' | 'year'): { from: string; to: string } {
  const t = mskToday()
  const [y, m] = t.split('-').map(Number)
  if (kind === 'year') return { from: `${y}-01-01`, to: t }
  if (kind === 'month') return { from: `${t.slice(0, 7)}-01`, to: t }
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate()
  const mm = String(pm).padStart(2, '0')
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${last}` }
}

export default function MeasurerEarnings({ meId, isOwner }: { meId: string; isOwner: boolean }) {
  const [preset, setPreset] = useState<'month' | 'prev' | 'year' | 'custom'>('month')
  const [range, setRange] = useState(period('month'))
  const [who, setWho] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ from: range.from, to: range.to })
    if (who) qs.set('measurer_id', who)
    const res = await fetch(`/api/measure-requests/earnings?${qs}`, { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setError(j.error || `Заработок не загрузился (${res.status})`); return }
    setError(''); setData(j as Data)
  }, [range, who])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  function pick(kind: 'month' | 'prev' | 'year') { setPreset(kind); setRange(period(kind)) }

  async function feePaid(r: Row) {
    const yes = await confirmDialog({ title: 'Отметить выплату?', text: `${fmt(r.measurer_fee)} замерщику ${r.measurer_name ?? ''} за ${r.deal_number || `#${r.id}`}.`, confirmLabel: 'Выплачено' })
    if (!yes) return
    setBusy(r.id); setError('')
    try {
      const res = await sendMeasure(`/api/measure-requests/${r.id}`, 'PATCH', { action: 'fee_paid' })
      if (!res.ok) { if (!res.cancelled) setError(res.error); return }
      setNotice('Выплата отмечена — сумма ушла из «компания должна».')
      await load()
    } finally { setBusy(null) }
  }

  const s = data?.summary
  const btn = (on: boolean) => `text-[12px] rounded-lg px-3 py-1.5 border ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:bg-[#f5f5f3]'}`
  const inp = 'bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px]'
  const tile = (label: string, b: { count: number; sum: number }, tone: string, hint?: string) => (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">{label}</p>
      <p className="text-[20px] font-bold font-mono mt-0.5">{b.count}</p>
      <p className="text-[12px] font-mono">{fmt(b.sum)}</p>
      {hint && <p className="text-[11px] opacity-80 mt-0.5">{hint}</p>}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => pick('month')} className={btn(preset === 'month')}>Этот месяц</button>
          <button onClick={() => pick('prev')} className={btn(preset === 'prev')}>Прошлый месяц</button>
          <button onClick={() => pick('year')} className={btn(preset === 'year')}>Этот год</button>
          <button onClick={() => setPreset('custom')} className={btn(preset === 'custom')}>Свой период</button>
          {data?.canPickMeasurer && (
            <select value={who} onChange={e => setWho(e.target.value)} className={`${inp} ml-auto`}>
              <option value="">Все замерщики</option>
              {data.measurers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-1.5 flex-wrap text-[12px] text-[#6b6b66]">
            с <input type="date" value={range.from} max={range.to} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} className={inp} />
            по <input type="date" value={range.to} min={range.from} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} className={inp} />
          </div>
        )}
        <p className="text-[11px] text-[#9a9a95]">Выполненные замеры с {range.from.split('-').reverse().join('.')} по {range.to.split('-').reverse().join('.')}, по дате замера. Сумма — по цене выезда, которая вышла на объекте.</p>
      </div>

      {error && <p className="text-[12px] text-red-600">{error}</p>}
      {notice && <p className="text-[12px] text-emerald-700">✅ {notice}</p>}
      {data?.truncated && <p className="text-[12px] text-amber-700">Период слишком большой — показаны не все замеры, итоги неполные. Сузь период.</p>}

      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {tile('Сделано замеров', s.done, 'bg-[#111110] text-white border-[#111110]')}
            {tile('💵 Оплачено на объекте', s.onsite, 'bg-emerald-50 text-emerald-800 border-emerald-200',
              s.done.count ? `${Math.round((s.onsite.count / s.done.count) * 100)}% замеров` : undefined)}
            {tile('🏢 Оплачено на компанию', s.company, 'bg-blue-50 text-blue-800 border-blue-200')}
            {tile('⏳ Не оплачено', s.unpaid, s.unpaid.count ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-[#6b6b66] border-[#e4e4e0]')}
            {s.unmarked.count > 0 && tile('❔ Оплата не отмечена', s.unmarked, 'bg-amber-50 text-amber-800 border-amber-200', 'отметь в строке ниже')}
          </div>

          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 text-[13px]">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">Гонорар за период</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>Всего: <b className="font-mono">{fmt(s.fee.total)}</b></span>
              <span className="text-emerald-700">получено на объекте: <b className="font-mono">{fmt(s.fee.onsite)}</b></span>
              <span>выплатила компания: <b className="font-mono">{fmt(s.fee.paidOut)}</b></span>
              <span className={s.fee.owed > 0 ? 'text-amber-700' : 'text-[#6b6b66]'}>компания должна: <b className="font-mono">{fmt(s.fee.owed)}</b></span>
            </div>
            {(s.fee.notSet > 0 || s.noPrice > 0) && (
              <p className="text-[12px] text-amber-700 mt-2">
                {s.fee.notSet > 0 && `У ${s.fee.notSet} замер(ов) гонорар не указан — в сумме они как 0 ₽. `}
                {s.noPrice > 0 && `У ${s.noPrice} замер(ов) нет цены выезда.`}
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">Замеры периода · {data.rows.length}</p>
            {data.rows.length === 0 ? <p className="text-[12px] text-[#c4c4be]">За период выполненных замеров нет.</p> : (
              <div className="divide-y divide-[#f0f0ec]">
                {data.rows.map(r => {
                  const owes = companyOwes(r)
                  const canEdit = isOwner || r.measurer_id === meId
                  return (
                    <div key={r.id} className={`py-2 ${busy === r.id ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-2 flex-wrap text-[12px]">
                        <span className="font-mono text-[#6b6b66]">{ddmm(r.scheduled_at)}</span>
                        <span className="font-semibold">{r.deal_number || `#${r.id}`} · {r.client_name}</span>
                        {isOwner && r.measurer_name && <span className="text-[#9a9a95]">· {r.measurer_name}</span>}
                        <span className="font-mono">
                          {r.actual_price != null
                            ? <><s className="text-[#9a9a95]">{fmt(Number(r.visit_price))}</s> <b>{fmt(finalPrice(r))}</b></>
                            : finalPrice(r) > 0 ? fmt(finalPrice(r)) : 'без цены'}
                        </span>
                        {r.visit_payment
                          ? <span className={`px-2 py-0.5 rounded-full ${PAY_TONE[r.visit_payment]}`}>{PAYMENT_LABEL[r.visit_payment]}</span>
                          : <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">оплата не отмечена</span>}
                        <span className="ml-auto text-[#6b6b66]">гонорар <b className="font-mono">{Number(r.measurer_fee) > 0 ? fmt(Number(r.measurer_fee)) : 'не указан'}</b></span>
                        {r.visit_payment !== 'onsite' && (
                          <span className={`px-2 py-0.5 rounded-full ${r.fee_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                            {r.fee_status === 'paid' ? 'выплачено' : 'к выплате'}
                          </span>
                        )}
                        {canEdit && editing !== r.id && (
                          <button onClick={() => setEditing(r.id)} className="text-[11px] border border-[#e4e4e0] rounded-lg px-2 py-0.5 hover:bg-[#f5f5f3]">изменить</button>
                        )}
                        {isOwner && owes > 0 && (
                          <button onClick={() => feePaid(r)} disabled={busy === r.id}
                            className="text-[11px] font-semibold bg-emerald-600 text-white rounded-lg px-2 py-0.5 hover:bg-emerald-700 disabled:opacity-40">💰 Выплачено</button>
                        )}
                      </div>
                      {r.price_note && <p className="text-[11px] text-[#6b6b66] mt-0.5">почему другая цена: {r.price_note}</p>}
                      {editing === r.id && (
                        <SettleForm r={r} mode="settle" onCancel={() => setEditing(null)}
                          onDone={msg => { setEditing(null); setNotice(msg); void load() }} />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
