'use client'

import { useEffect, useRef, useState } from 'react'
import { buildMeasureResultMessage, splitScope, tidy } from '@/lib/measure/message'
import { periodRange, type PeriodPreset } from '@/lib/measure/client'
import { PAYMENT_LABEL, finalPrice } from '@/lib/measure/money'
import { telHref } from '@/lib/b2c/phoneKey'
import { STATUS_META, type MeasureReq } from '@/components/measure/types'

// «История» замерщика (владелец 01.10: «какие я замеры делал за такой-то промежуток…
// поиск замера по адресу, по номеру телефона, по номеру заказа»). Период — по дате
// замера, у заявок без времени — по дате создания. Поиск и фильтры — на сервере,
// в круге видимости; замерщику показываем только его замеры, без чужого пула.

type Preset = PeriodPreset | 'all' | 'custom'
const PRESETS: [Preset, string][] = [['month', 'Этот месяц'], ['prev', 'Прошлый'], ['year', 'Год'], ['all', 'Всё время'], ['custom', 'Свой период']]
const STATUSES: [string, string][] = [['', 'Все'], ['done', '✅ Выполнены'], ['scheduled', '📅 Назначены'], ['issue', '⚠️ Сложность'], ['cancelled', '✕ Отменены']]
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' })

export default function MeasureHistory({ meId, isMeasurer }: { meId: string; isMeasurer: boolean }) {
  const [preset, setPreset] = useState<Preset>('month')
  const [range, setRange] = useState(() => periodRange('month'))
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [kind, setKind] = useState<'all' | 'new' | 'repeat'>('all')
  const [rows, setRows] = useState<MeasureReq[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const seq = useRef(0)

  // Поиск — с паузой после ввода; ответ на устаревший запрос отбрасываем.
  useEffect(() => {
    const qs = new URLSearchParams()
    if (q.trim()) qs.set('q', q.trim())
    if (preset !== 'all' && range.from && range.to) { qs.set('from', range.from); qs.set('to', range.to) }
    if (status) qs.set('status', status)
    const id = ++seq.current
    const t = setTimeout(async () => {
      const res = await fetch(`/api/measure-requests?${qs}`, { cache: 'no-store' }).catch(() => null)
      const j = res ? await res.json().catch(() => ({})) : {}
      if (id !== seq.current) return
      if (!res || !res.ok) { setError(j.error || 'История не загрузилась — нет связи'); return }
      setError(''); setRows(j.requests as MeasureReq[]); setTruncated(!!j.truncated)
    }, q ? 350 : 0)
    return () => clearTimeout(t)
  }, [q, preset, range, status])

  function pick(p: Preset) {
    setPreset(p)
    if (p !== 'all' && p !== 'custom') setRange(periodRange(p))
  }
  async function copy(r: MeasureReq) {
    try {
      await navigator.clipboard.writeText(buildMeasureResultMessage(r))
      setCopied(r.id); setTimeout(() => setCopied(c => (c === r.id ? null : c)), 2000)
    } catch { setError('Не удалось скопировать — браузер не дал доступ к буферу обмена.') }
  }

  const mine = (rows ?? []).filter(r => !isMeasurer || r.measurer_id === meId)
  const list = mine
    .filter(r => kind === 'all' || (kind === 'repeat') === !!r.is_repeat)
    .sort((a, b) => (b.scheduled_at ?? b.created_at).localeCompare(a.scheduled_at ?? a.created_at))
  const repeats = mine.filter(r => r.is_repeat).length
  const chip = (on: boolean) => `text-[12px] rounded-full px-3 py-1 border ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white border-[#e4e4e0] text-[#4b4b47] hover:bg-[#f5f5f3]'}`
  const inp = 'bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110]'

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-[#e4e4e0] p-3 space-y-2">
        <input value={q} onChange={e => { setQ(e.target.value); if (e.target.value && preset === 'month') pick('all') }} type="search"
          placeholder="🔎 Адрес, телефон, № заказа, клиент"
          className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map(([k, l]) => <button key={k} onClick={() => pick(k)} className={chip(preset === k)}>{l}</button>)}
          {preset === 'custom' && (
            <span className="flex items-center gap-1 text-[12px]">
              <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className={inp} />
              —
              <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className={inp} />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUSES.map(([k, l]) => <button key={k} onClick={() => setStatus(k)} className={chip(status === k)}>{l}</button>)}
          <span className="w-px h-5 bg-[#e4e4e0] mx-1" />
          {([['all', 'Все'], ['new', '📐 Новые'], ['repeat', '🔁 Повторные']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} className={chip(kind === k)}>{l}</button>
          ))}
        </div>
        {preset === 'custom' && range.from > range.to && <p className="text-[11px] text-red-600">Начало периода позже конца — период не применён.</p>}
        <p className="text-[11px] text-[#9a9a95]">
          {preset === 'all' ? 'За всё время' : `С ${range.from.split('-').reverse().join('.')} по ${range.to.split('-').reverse().join('.')}`} — по дате замера, у заявок без времени — по дате создания.
        </p>
      </div>

      {error && <p className="text-[12px] text-red-600">{error}</p>}
      {truncated && <p className="text-[12px] text-amber-700">Найдено больше, чем показано, — уточни поиск или период.</p>}
      {rows && (
        <p className="text-[12px] text-[#4b4b47]">
          Найдено <b>{mine.length}</b>: 📐 новых {mine.length - repeats} · 🔁 повторных {repeats}
        </p>
      )}

      <div className="space-y-2">
        {rows && list.length === 0 && <p className="text-[12px] text-[#9a9a95]">Ничего не нашлось.</p>}
        {list.map(r => {
          const st = STATUS_META[r.status] ?? { label: r.status, cls: 'bg-[#f0f0ec] text-[#6b6b66]' }
          const items = splitScope(r.scope)
          const tel = telHref(r.phone)
          return (
            <div key={r.id} className="bg-white border border-[#e4e4e0] rounded-lg p-3 space-y-1 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{r.scheduled_at ? day(r.scheduled_at) : `создана ${day(r.created_at)}`}</span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                <span className={`text-[11px] ${r.is_repeat ? 'text-violet-700 font-semibold' : 'text-[#9a9a95]'}`}>{r.is_repeat ? '🔁 Повторный' : '📐 Новый'}</span>
                {!isMeasurer && r.measurer_name && <span className="text-[11px] text-[#9a9a95]">· {r.measurer_name}</span>}
              </div>
              <p className="text-[13px] font-semibold">{r.deal_number ? `${r.deal_number} · ` : ''}{tidy(r.client_name)}</p>
              <p className="text-[#6b6b66]">
                {r.address && <>📍 {r.address}</>}
                {tel && <> · <a href={tel} className="text-blue-700 hover:underline">📞 {r.phone}</a></>}
              </p>
              {items.length > 0 && <p className="text-[#6b6b66]">📏 {items.join('; ')}</p>}
              {r.status === 'done' && (
                <p className="text-[#6b6b66]">
                  💰 {finalPrice(r) > 0 ? fmt(finalPrice(r)) : 'без цены'}
                  {r.actual_price != null && <span className="text-[#9a9a95]"> (менеджер: {fmt(Number(r.visit_price))}{r.price_note ? `, ${r.price_note}` : ''})</span>}
                  {' · '}{r.visit_payment ? PAYMENT_LABEL[r.visit_payment] : <span className="text-amber-700">оплата не отмечена</span>}
                </p>
              )}
              {r.issue_text && <p className="text-red-600">⚠️ {r.issue_text}{r.issue_solution ? ` → 💡 ${r.issue_solution}` : ''}</p>}
              {r.result_note && <p className="text-[#111110] whitespace-pre-line">📝 {r.result_note}</p>}
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {Array.isArray(r.photos) && r.photos.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-700 hover:underline">📎 файл {i + 1}</a>
                ))}
                {r.status === 'done' && (
                  <button onClick={() => copy(r)}
                    className={`text-[11px] border rounded-lg px-2 py-0.5 ${copied === r.id ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[#e4e4e0] bg-white hover:bg-[#f5f5f3]'}`}>
                    {copied === r.id ? '✓ Скопировано' : '📋 Замер готов'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
