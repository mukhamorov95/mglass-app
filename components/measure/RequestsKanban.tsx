'use client'

import { useState } from 'react'
import { buildMeasureMessage, buildMeasureResultMessage, formatMeasureWhen, splitScope, tidy } from '@/lib/measure/message'
import { askCancelReason, sendMeasure } from '@/lib/measure/client'
import { PAYMENT_LABEL, finalPrice } from '@/lib/measure/money'
import { confirmDialog, type ConfirmOptions } from '@/lib/dialog'
import BookingPicker, { type BookingValue } from '@/components/measure/BookingPicker'
import type { MeasureMe, MeasureReq, MeasurerLite } from '@/components/measure/types'

// Канбан заявок менеджера: в каком процессе каждая. Колонки — статусы заявки,
// руками карточки не двигают: колонку меняет действие (назначить, выполнить у
// замерщика, отменить). Выполненные — за последние 30 дней, при поиске — все найденные.
// Новые и повторные замеры — раздельно (владелец 01.10): фильтр сверху, метка на карточке.

const COLUMNS: { status: string; title: string; hint: string; tone: string }[] = [
  { status: 'new', title: '🆕 Ждут замерщика', hint: 'замерщик договорится с клиентом и назначит время', tone: 'border-amber-200 bg-amber-50/50' },
  { status: 'scheduled', title: '📅 Назначены', hint: 'есть замерщик и время', tone: 'border-blue-200 bg-blue-50/40' },
  { status: 'issue', title: '⚠️ Сложность', hint: 'замерщик описал проблему — нужно решение', tone: 'border-red-200 bg-red-50/40' },
  { status: 'done', title: '✅ Выполнены', hint: 'за 30 дней', tone: 'border-emerald-200 bg-emerald-50/40' },
]
const DAY = 86_400_000
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const EMPTY_BOOKING: BookingValue = { measurerId: '', date: '', time: '', durationMin: 90, travelMin: 60 }

export default function RequestsKanban({ me, requests, measurers, searching, onChanged }: {
  me: MeasureMe
  requests: MeasureReq[]
  measurers: MeasurerLite[]
  searching: boolean
  onChanged: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const [assignFor, setAssignFor] = useState<number | null>(null)
  const [assignVal, setAssignVal] = useState<BookingValue>(EMPTY_BOOKING)
  const [showCancelled, setShowCancelled] = useState(false)
  const [kind, setKind] = useState<'all' | 'new' | 'repeat'>('all')

  // «Сейчас» берём один раз: для «ждёт N дн.» и окна 30 дней точность до минуты не нужна.
  const [now] = useState(() => Date.now())
  const recent = (r: MeasureReq) => searching || now - new Date(r.scheduled_at ?? r.created_at).getTime() <= 30 * DAY
  const ofKind = (r: MeasureReq) => kind === 'all' || (kind === 'repeat') === !!r.is_repeat
  const shown = requests.filter(ofKind)
  const byId = new Map(requests.map(r => [r.id, r]))
  // Прежний замер может не попасть в выборку (давний, другой менеджер) — тогда номер.
  const repeatOfLabel = (id: number) => {
    const o = byId.get(id)
    return o?.scheduled_at ? `от ${formatMeasureWhen(o.scheduled_at).split(',')[0]}` : `№${id}`
  }
  const byCol = (status: string) => {
    const rows = shown.filter(r => r.status === status && (status !== 'done' || recent(r)))
    if (status === 'new') return rows.sort((a, b) => a.created_at.localeCompare(b.created_at))
    if (status === 'scheduled') return rows.sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
    return rows.sort((a, b) => (b.scheduled_at ?? b.created_at).localeCompare(a.scheduled_at ?? a.created_at))
  }
  const cancelled = shown.filter(r => r.status === 'cancelled' && recent(r))
  const live = requests.filter(r => r.status !== 'cancelled' && (r.status !== 'done' || recent(r)))
  const repeats = live.filter(r => r.is_repeat).length

  async function act(r: MeasureReq, body: Record<string, unknown>, ask?: ConfirmOptions) {
    if (ask && !(await confirmDialog(ask))) return
    setBusy(r.id); setError('')
    try {
      const res = await sendMeasure(`/api/measure-requests/${r.id}`, 'PATCH', body)
      if (!res.ok) { if (!res.cancelled) setError(res.error); return }
      setAssignFor(null)
      await onChanged()
    } finally { setBusy(null) }
  }

  function openAssign(r: MeasureReq) {
    const at = r.scheduled_at ? new Date(new Date(r.scheduled_at).getTime() + 3 * 3600_000).toISOString() : ''
    setAssignFor(r.id)
    setAssignVal({
      measurerId: r.measurer_id ?? (measurers.length === 1 ? measurers[0].id : ''),
      date: at.slice(0, 10), time: at.slice(11, 16), durationMin: r.duration_min || 90, travelMin: r.travel_min ?? 60,
    })
  }

  // Текст собирается из заявки в момент копирования: до замера — замерщику,
  // после — «замер готов» в формате темы группы.
  async function copy(r: MeasureReq) {
    try {
      await navigator.clipboard.writeText(r.status === 'done' ? buildMeasureResultMessage(r) : buildMeasureMessage(r))
      setCopied(r.id)
      setTimeout(() => setCopied(c => (c === r.id ? null : c)), 2000)
    } catch { setError('Не удалось скопировать — браузер не дал доступ к буферу обмена.') }
  }

  const btn = 'text-[11px] border border-[#e4e4e0] bg-white rounded-lg px-2 py-1 hover:bg-[#f5f5f3]'

  function card(r: MeasureReq) {
    const items = splitScope(r.scope)
    const waitDays = Math.floor((now - new Date(r.created_at).getTime()) / DAY)
    return (
      <div key={r.id} className={`bg-white border border-[#e4e4e0] rounded-lg p-2.5 space-y-1 ${busy === r.id ? 'opacity-50 pointer-events-none' : ''}`}>
        {r.is_repeat && (
          <p className="text-[10px] font-semibold text-violet-700">
            🔁 ПОВТОРНЫЙ{r.repeat_of ? ` · к замеру ${repeatOfLabel(r.repeat_of)}` : ''}
          </p>
        )}
        <p className="text-[13px] font-semibold leading-snug">{r.deal_number ? `${r.deal_number} · ` : ''}{tidy(r.client_name)}</p>
        {me.scope === 'all' && r.manager_name && <p className="text-[11px] text-[#9a9a95]">👔 {r.manager_name}</p>}
        {r.address && <p className="text-[12px] text-[#6b6b66]">📍 {r.address}</p>}
        {items.length > 0 && <p className="text-[12px] text-[#6b6b66]">📏 {items.slice(0, 2).join('; ')}{items.length > 2 ? ` и ещё ${items.length - 2}` : ''}</p>}
        {r.status === 'new' && <p className={`text-[11px] ${waitDays >= 2 ? 'text-red-600 font-semibold' : 'text-[#9a9a95]'}`}>{waitDays === 0 ? 'создана сегодня' : `ждёт ${waitDays} дн.`}</p>}
        {r.scheduled_at && r.status !== 'new' && (
          <p className="text-[12px]"><span className="font-mono font-semibold">{formatMeasureWhen(r.scheduled_at, r.duration_min)}</span>{r.measurer_name ? ` · ${r.measurer_name}` : ''}</p>
        )}
        {r.issue_text && <p className="text-[12px] text-red-600">⚠️ {r.issue_text}{r.issue_solution ? ` → 💡 ${r.issue_solution}` : ''}</p>}
        {r.status === 'cancelled' && r.cancel_reason && <p className="text-[12px] text-[#6b6b66]">✕ {r.cancel_reason}{r.cancelled_by_name ? ` — ${r.cancelled_by_name}` : ''}</p>}
        {r.status === 'done' && (
          <>
            <p className="text-[12px] text-[#6b6b66]">
              💰 {finalPrice(r) > 0 ? fmt(finalPrice(r)) : 'без цены'}
              {r.actual_price != null && <span className="text-[#9a9a95]"> (было {fmt(Number(r.visit_price))}{r.price_note ? `: ${r.price_note}` : ''})</span>}
              {' · '}{r.visit_payment ? PAYMENT_LABEL[r.visit_payment] : <span className="text-amber-700">оплата не отмечена</span>}
            </p>
            {r.result_note && <p className="text-[12px] text-[#111110] whitespace-pre-line">📝 {r.result_note}</p>}
          </>
        )}
        {Array.isArray(r.photos) && r.photos.length > 0 && (
          <p className="flex flex-wrap gap-2">{r.photos.map((u, i) => <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-700 hover:underline">📎 файл {i + 1}</a>)}</p>
        )}
        <div className="flex flex-wrap gap-1 pt-1">
          <button onClick={() => copy(r)} className={`${btn} ${copied === r.id ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : ''}`}>
            {copied === r.id ? '✓ Скопировано' : r.status === 'done' ? '📋 Замер готов' : '📋 Замерщику'}
          </button>
          {me.canCreate && (r.status === 'new' || r.status === 'scheduled' || r.status === 'issue') && measurers.length > 0 && assignFor !== r.id && (
            <button onClick={() => openAssign(r)} className={btn}>{r.status === 'new' ? '📅 Назначить' : '↔ Перенести'}</button>
          )}
          {me.canCreate && (r.status === 'scheduled' || r.status === 'issue') && (
            <button onClick={() => act(r, { action: 'unassign' }, { title: 'Вернуть заявку в пул?', text: 'Время снимется, замерщик увидит её снова как новую.', confirmLabel: 'Вернуть в пул' })} className={btn}>↩ В пул</button>
          )}
          {me.canCreate && (r.status === 'new' || r.status === 'scheduled' || r.status === 'issue') && (
            <button onClick={async () => { const reason = await askCancelReason(); if (reason) act(r, { action: 'cancel', reason }) }} className={`${btn} text-red-600`} title="Отменить — спросит почему">✕</button>
          )}
          {me.canCreate && r.status === 'cancelled' && (
            <button onClick={() => act(r, { action: 'reopen' })} className={btn}>↺ Вернуть в работу</button>
          )}
        </div>
        {assignFor === r.id && (
          <div className="rounded-lg border border-[#e4e4e0] bg-[#fafaf8] p-2 space-y-2">
            <BookingPicker value={assignVal} onChange={setAssignVal} measurers={measurers} excludeRequestId={r.id} />
            <div className="flex items-center gap-2">
              <button disabled={!assignVal.measurerId || !assignVal.date || !assignVal.time}
                onClick={() => act(r, { action: 'schedule', measurer_id: assignVal.measurerId, date: assignVal.date, time: assignVal.time, duration_min: assignVal.durationMin, travel_min: assignVal.travelMin })}
                className="text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-40">✅ Назначить</button>
              <button onClick={() => setAssignFor(null)} className="text-[12px] text-[#9a9a95]">отмена</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] rounded-lg px-3 py-2 flex items-start gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-700">✕</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {([['all', `Все · ${live.length}`], ['new', `📐 Новые · ${live.length - repeats}`], ['repeat', `🔁 Повторные · ${repeats}`]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)}
            className={`text-[12px] rounded-full px-3 py-1 border ${kind === k ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white border-[#e4e4e0] text-[#4b4b47] hover:bg-[#f5f5f3]'}`}>{label}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-start">
        {COLUMNS.map(c => {
          const rows = byCol(c.status)
          return (
            <section key={c.status} className={`rounded-xl border p-2.5 space-y-2 ${c.tone}`}>
              <div>
                <p className="text-[12px] font-bold">{c.title} · {rows.length}</p>
                <p className="text-[10px] text-[#9a9a95]">{c.status === 'done' && searching ? 'найденные' : c.hint}</p>
              </div>
              {rows.length === 0 ? <p className="text-[11px] text-[#c4c4be] px-1 pb-1">пусто</p> : rows.map(card)}
            </section>
          )
        })}
      </div>
      {cancelled.length > 0 && (
        <div>
          <button onClick={() => setShowCancelled(v => !v)} className="text-[12px] text-[#9a9a95] hover:text-[#111110]">
            {showCancelled ? '▾' : '▸'} Отменённые · {cancelled.length}
          </button>
          {showCancelled && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 mt-2">{cancelled.map(card)}</div>}
        </div>
      )}
    </div>
  )
}
