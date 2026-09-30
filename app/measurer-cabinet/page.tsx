'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatMeasureWhen, splitScope, tidy } from '@/lib/measure/message'
import { mskDate } from '@/lib/measure/slots'
import { mskToday, sendMeasure } from '@/lib/measure/client'
import { telHref } from '@/lib/b2c/phoneKey'
import MeasureBoard from '@/components/measure/MeasureBoard'
import MeasurerAvailability from '@/components/measure/MeasurerAvailability'
import BookingPicker, { type BookingValue } from '@/components/measure/BookingPicker'

// Кабинет замерщика: сегодня (куда ехать, кому звонить, что мерить) → пул новых
// заявок («Взять» в своё свободное окно) → дальше по дням → занятость всех
// замерщиков → мой график (часы, выходные) → деньги месяца и история.
// Владелец видит то же по всем замерщикам и может назначить любого.

type MReq = {
  id: number
  deal_number: string | null
  client_name: string
  phone: string | null
  amo_url: string | null
  address: string | null
  scope: string | null
  notes: string | null
  visit_price: number
  payer: string | null
  is_repeat: boolean
  manager_name: string | null
  measurer_id: string | null
  measurer_name: string | null
  scheduled_at: string | null
  duration_min: number | null
  status: string
  issue_text: string | null
  issue_solution: string | null
  measurer_fee: number
  fee_status: string
  photos: string[] | null
  created_at: string
}
type Me = { id: string; name: string; role: string; scope: string }

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const byTime = (a: MReq, b: MReq) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '')
const WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MONTH = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const dayTitle = (date: string) => { const d = new Date(`${date}T00:00:00Z`); return `${WEEKDAY[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}` }
const EMPTY_BOOKING: BookingValue = { measurerId: '', date: '', time: '', durationMin: 90 }

export default function MeasurerCabinetPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [reqs, setReqs] = useState<MReq[]>([])
  const [measurers, setMeasurers] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [boardKey, setBoardKey] = useState(0)
  // Открытая форма у карточки: взять/перенести (booking) или сложность (issue).
  const [openFor, setOpenFor] = useState<{ id: number; kind: 'book' | 'issue' } | null>(null)
  const [bookVal, setBookVal] = useState<BookingValue>(EMPTY_BOOKING)
  const [issueText, setIssueText] = useState('')
  const [issueSol, setIssueSol] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/measure-requests', { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(j.error || `Заявки не загрузились (${res.status})`)
    else { setMe(j.me); setReqs(j.requests as MReq[]); setMeasurers(j.measurers ?? []) }
    setLoading(false)
    setBoardKey(k => k + 1)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  const isOwner = me?.role === 'admin' || me?.role === 'ceo'
  const isMeasurer = me?.role === 'measurer'
  const today = mskToday()

  const pool = useMemo(() => reqs.filter(r => r.status === 'new').sort((a, b) => a.created_at.localeCompare(b.created_at)), [reqs])
  const assigned = useMemo(() => reqs.filter(r => r.measurer_id && (isOwner || r.measurer_id === me?.id)), [reqs, me, isOwner])
  const active = useMemo(() => assigned.filter(r => (r.status === 'scheduled' || r.status === 'issue') && r.scheduled_at).sort(byTime), [assigned])
  const todays = active.filter(r => mskDate(r.scheduled_at!) === today)
  const overdue = active.filter(r => mskDate(r.scheduled_at!) < today)
  const upcoming = useMemo(() => {
    const groups = new Map<string, MReq[]>()
    for (const r of active.filter(x => mskDate(x.scheduled_at!) > today)) {
      const d = mskDate(r.scheduled_at!)
      groups.set(d, [...(groups.get(d) ?? []), r])
    }
    return [...groups.entries()]
  }, [active, today])

  // Деньги месяца: замерщику — свои, владельцу — по всем замерщикам.
  const money = useMemo(() => {
    const month = today.slice(0, 7)
    const done = assigned.filter(r => r.status === 'done' && r.scheduled_at && mskDate(r.scheduled_at).startsWith(month))
    const earned = done.reduce((s, r) => s + (Number(r.measurer_fee) || 0), 0)
    const paid = done.filter(r => r.fee_status === 'paid').reduce((s, r) => s + (Number(r.measurer_fee) || 0), 0)
    return { count: done.length, earned, paid, pending: earned - paid }
  }, [assigned, today])
  const history = useMemo(() => assigned.filter(r => r.status === 'done' || r.status === 'issue')
    .sort((a, b) => (b.scheduled_at ?? '').localeCompare(a.scheduled_at ?? '')).slice(0, 30), [assigned])

  async function act(r: MReq, body: Record<string, unknown>, done?: string) {
    setBusy(r.id); setError(''); setNotice('')
    try {
      const res = await sendMeasure(`/api/measure-requests/${r.id}`, 'PATCH', body)
      if (!res.ok) { if (!res.cancelled) setError(res.error); return }
      setOpenFor(null)
      if (done) setNotice(done)
      await load()
    } finally { setBusy(null) }
  }

  function openBooking(r: MReq) {
    const at = r.scheduled_at ? new Date(new Date(r.scheduled_at).getTime() + 3 * 3600_000).toISOString() : ''
    setOpenFor({ id: r.id, kind: 'book' })
    setBookVal({
      measurerId: isMeasurer ? me!.id : (r.measurer_id ?? (measurers.length === 1 ? measurers[0].id : '')),
      date: at.slice(0, 10) || today, time: at.slice(11, 16), durationMin: r.duration_min || 90,
    })
  }

  async function submitBooking(r: MReq) {
    const label = `${dayTitle(bookVal.date)}, ${bookVal.time}`
    await act(r, { action: 'schedule', measurer_id: bookVal.measurerId, date: bookVal.date, time: bookVal.time, duration_min: bookVal.durationMin },
      r.status === 'new'
        ? `Заявка ${r.deal_number || `#${r.id}`} взята: ${label}. Она в «Дальше» и на доске — менеджер видит время.`
        : `Замер перенесён на ${label}.`)
  }

  async function attachFile(r: MReq, file: File) {
    setBusy(r.id); setError('')
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/measure-requests/${r.id}/photo`, { method: 'POST', body: fd })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || `Файл не загружен (${res.status})`); return }
      setNotice(`Файл приложен к замеру ${r.deal_number || `#${r.id}`} — менеджер видит его в карточке сделки.`)
      await load()
    } finally { setBusy(null) }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  const btn = 'text-[12px] border border-[#e4e4e0] bg-white rounded-lg px-2.5 py-1.5 hover:bg-[#f5f5f3]'
  const canBook = isMeasurer || (isOwner && measurers.length > 0)

  // Функции отрисовки, а не вложенные компоненты: вложенный компонент пересоздаётся
  // на каждый рендер, и поле ввода внутри теряет фокус после каждой буквы.
  function details(r: MReq) {
    const items = splitScope(r.scope)
    const tel = telHref(r.phone)
    return (
      <div className="text-[12px] text-[#4b4b47] space-y-1 mt-1.5">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {r.phone && (tel
            ? <a href={tel} className="font-mono text-blue-700 hover:underline">📞 {r.phone}</a>
            : <span className="font-mono">📞 {r.phone}</span>)}
          {r.address && <span>📍 {r.address}</span>}
          {r.address && (
            <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(r.address)}`} target="_blank" rel="noopener noreferrer"
              className="text-blue-700 hover:underline">🗺 на карте</a>
          )}
        </div>
        {items.length > 0 && (
          items.length === 1 ? <p>📏 {items[0]}</p> : (
            <ol className="list-decimal pl-5">{items.map((it, i) => <li key={i}>{it}</li>)}</ol>
          )
        )}
        {r.notes && <p>💬 {r.notes}</p>}
        <p className="text-[#9a9a95]">
          💰 выезд {Number(r.visit_price) > 0 ? fmt(Number(r.visit_price)) : 'цена не указана'}{r.payer ? ` · платит ${r.payer}` : ''}
          {' · '}гонорар {fmt(Number(r.measurer_fee) || 0)}
          {r.manager_name ? ` · менеджер ${r.manager_name}` : ''}
          {r.amo_url && <> · <a href={r.amo_url} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">amo</a></>}
        </p>
      </div>
    )
  }

  function bookingForm(r: MReq, cta: string) {
    return (
      <div className="mt-2 rounded-lg border border-[#e4e4e0] bg-[#fafaf8] p-3 space-y-2">
        <BookingPicker value={bookVal} onChange={setBookVal} measurers={measurers}
          lockMeasurer={isMeasurer} excludeRequestId={r.status === 'new' ? undefined : r.id} />
        <div className="flex items-center gap-2">
          <button onClick={() => submitBooking(r)} disabled={busy === r.id || !bookVal.measurerId || !bookVal.date || !bookVal.time}
            className="text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-40">{cta}</button>
          <button onClick={() => setOpenFor(null)} className="text-[12px] text-[#9a9a95]">отмена</button>
        </div>
      </div>
    )
  }

  function activeCard(r: MReq) {
    const open = openFor?.id === r.id
    return (
      <div key={r.id} className={`bg-white border rounded-xl p-3 ${r.status === 'issue' ? 'border-red-200' : 'border-[#e4e4e0]'} ${busy === r.id ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[13px] font-bold">{formatMeasureWhen(r.scheduled_at!, r.duration_min)}</span>
          <span className="text-[13px] font-semibold">{r.is_repeat ? '🔁' : '📐'} {r.deal_number || `#${r.id}`} · {tidy(r.client_name)}</span>
          {isOwner && r.measurer_name && <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f0ec] text-[#4b4b47]">📏 {r.measurer_name}</span>}
          {r.status === 'issue' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700">⚠️ сложность</span>}
        </div>
        {details(r)}
        {r.issue_text && <p className="text-[12px] text-red-600 mt-1">⚠️ {r.issue_text}{r.issue_solution ? ` → 💡 ${r.issue_solution}` : ''}</p>}
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <button onClick={() => act(r, { action: 'done' }, `Замер ${r.deal_number || `#${r.id}`} выполнен — гонорар ${fmt(Number(r.measurer_fee) || 0)} в «Ожидает выплаты».`)}
            className="text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-emerald-700">✅ Выполнен</button>
          <button onClick={() => { setOpenFor({ id: r.id, kind: 'issue' }); setIssueText(r.issue_text ?? ''); setIssueSol(r.issue_solution ?? '') }}
            className={`${btn} text-red-600 border-red-200`}>⚠️ Сложность</button>
          <label className={`${btn} cursor-pointer`}>
            📎 Файл{Array.isArray(r.photos) && r.photos.length > 0 ? ` (${r.photos.length})` : ''}
            <input type="file" accept="image/*,application/pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) attachFile(r, f); e.target.value = '' }} />
          </label>
          {canBook && <button onClick={() => openBooking(r)} className={btn}>↔ Перенести</button>}
          <button onClick={() => { if (window.confirm('Вернуть заявку в пул? Время снимется, менеджер увидит её снова как новую.')) act(r, { action: 'unassign' }, 'Заявка вернулась в пул.') }}
            className={btn}>↩ В пул</button>
        </div>
        {open && openFor?.kind === 'book' && bookingForm(r, '✅ Перенести')}
        {open && openFor?.kind === 'issue' && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50/40 p-3 space-y-2">
            <textarea value={issueText} onChange={e => setIssueText(e.target.value)} rows={2} placeholder="Какая сложность? (нет доступа, стена кривая, клиент не пришёл…)"
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px]" />
            <input value={issueSol} onChange={e => setIssueSol(e.target.value)} placeholder="Какое видишь решение?"
              className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px]" />
            <div className="flex items-center gap-2">
              <button disabled={!issueText.trim() || busy === r.id}
                onClick={() => act(r, { action: 'issue', issue_text: issueText, issue_solution: issueSol }, 'Сложность записана — менеджер видит её в заявке.')}
                className="text-[12px] font-semibold bg-red-600 text-white rounded-lg px-3 py-1.5 hover:bg-red-700 disabled:opacity-40">Записать</button>
              <button onClick={() => setOpenFor(null)} className="text-[12px] text-[#9a9a95]">отмена</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Кабинет замерщика</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">
          {isOwner ? 'Все замерщики: сегодня, пул новых заявок, дальше по дням, график и выплаты.'
            : 'Сегодня — куда ехать. Новые заявки — бери в своё свободное окно: менеджер сразу видит время.'}
        </p>
        <div className="flex flex-wrap gap-2 mt-3 text-[12px]">
          <span className="px-2.5 py-1 rounded-full bg-[#111110] text-white">Сегодня: {todays.length}</span>
          <span className={`px-2.5 py-1 rounded-full ${pool.length ? 'bg-amber-100 text-amber-800' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>Новых заявок: {pool.length}</span>
          <span className="px-2.5 py-1 rounded-full bg-[#f0f0ec] text-[#6b6b66]">Дальше: {active.length - todays.length - overdue.length}</span>
          {overdue.length > 0 && <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-700">Не отмечены: {overdue.length}</span>}
        </div>
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1100px]">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] rounded-lg px-3 py-2 flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-700">✕</button>
          </div>
        )}
        {notice && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[12px] rounded-lg px-3 py-2 flex items-start gap-2">
            <span className="flex-1">✅ {notice}</span>
            <button onClick={() => setNotice('')} className="text-emerald-500 hover:text-emerald-800">✕</button>
          </div>
        )}
        {isOwner && measurers.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
            В приложении нет пользователей с ролью «Замерщик» — брать заявки и вести график некому. Заведи Сергея и Глеба в «Пользователях» с ролью «Замерщик».
          </div>
        )}

        {overdue.length > 0 && (
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-red-700">Прошли, но не отмечены · {overdue.length}</p>
            {overdue.map(activeCard)}
          </section>
        )}

        <section className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Сегодня, {dayTitle(today)} · {todays.length}</p>
          {todays.length === 0 ? <p className="text-[12px] text-[#c4c4be]">На сегодня замеров нет.</p> : todays.map(activeCard)}
        </section>

        <section className={`rounded-xl border p-4 ${pool.length ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#e4e4e0]'}`}>
          <p className={`text-[11px] font-bold uppercase tracking-widest ${pool.length ? 'text-amber-700' : 'text-[#9a9a95]'}`}>🆕 Новые заявки — ждут замерщика · {pool.length}</p>
          {pool.length === 0 ? <p className="text-[12px] text-[#c4c4be] mt-1">Пул пуст.</p> : (
            <div className="mt-2 space-y-2">
              {pool.map(r => (
                <div key={r.id} className={`bg-white border border-amber-100 rounded-lg p-3 ${busy === r.id ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold">{r.is_repeat ? '🔁' : '📐'} {r.deal_number || `#${r.id}`} · {tidy(r.client_name)}</span>
                    <span className="text-[11px] text-[#9a9a95]">создана {new Date(r.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short' })}</span>
                  </div>
                  {details(r)}
                  {canBook && (openFor?.id === r.id && openFor.kind === 'book'
                    ? bookingForm(r, isMeasurer ? '✅ Беру' : '✅ Назначить')
                    : (
                      <button onClick={() => openBooking(r)}
                        className="mt-2 text-[12px] font-semibold bg-[#111110] text-white rounded-lg px-3 py-1.5 hover:bg-[#2a2a28]">
                        {isMeasurer ? '📅 Взять — выбрать время' : '📅 Назначить замерщика'}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Дальше</p>
          {upcoming.length === 0 ? <p className="text-[12px] text-[#c4c4be]">Назначенных замеров впереди нет.</p> : upcoming.map(([d, items]) => (
            <div key={d} className="space-y-2">
              <p className="text-[12px] font-bold capitalize text-[#4b4b47]">{dayTitle(d)} · {items.length}</p>
              {items.map(activeCard)}
            </div>
          ))}
        </section>

        <MeasureBoard title="Все замерщики — занятость" refreshKey={boardKey} />
        <MeasurerAvailability onChanged={() => setBoardKey(k => k + 1)} />

        {/* Деньги месяца */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[#111110] text-white rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a8a85]">Выполнено за месяц</p>
            <p className="text-[20px] font-bold font-mono mt-1">{money.count}</p>
          </div>
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">Гонорар за месяц</p>
            <p className="text-[18px] font-bold font-mono mt-1">{fmt(money.earned)}</p>
          </div>
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9a9a95]">Выплачено</p>
            <p className="text-[18px] font-bold font-mono text-emerald-700 mt-1">{fmt(money.paid)}</p>
          </div>
          <div className={`rounded-xl p-4 border ${money.pending > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#e4e4e0]'}`}>
            <p className={`text-[10px] font-bold uppercase tracking-widest ${money.pending > 0 ? 'text-amber-700' : 'text-[#9a9a95]'}`}>Ожидает выплаты</p>
            <p className={`text-[18px] font-bold font-mono mt-1 ${money.pending > 0 ? 'text-amber-700' : ''}`}>{fmt(money.pending)}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">Выполненные и сложности</p>
          {history.length === 0 ? <p className="text-[12px] text-[#c4c4be]">Пока пусто.</p> : (
            <div className="space-y-2">
              {history.map(r => (
                <div key={r.id} className="border border-[#f0f0ec] rounded-lg p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium">{r.status === 'done' ? '✅' : '⚠️'} {r.deal_number || `#${r.id}`} · {tidy(r.client_name)}</span>
                    {r.scheduled_at && <span className="text-[11px] text-[#9a9a95]">{dayTitle(mskDate(r.scheduled_at))}</span>}
                    {isOwner && r.measurer_name && <span className="text-[11px] text-[#9a9a95]">· {r.measurer_name}</span>}
                    <span className="text-[12px] font-mono ml-auto">{fmt(r.measurer_fee)}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${r.fee_status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {r.fee_status === 'paid' ? 'выплачено' : 'к выплате'}
                    </span>
                    {isOwner && r.status === 'done' && r.fee_status !== 'paid' && (
                      <button onClick={() => { if (window.confirm(`Отметить выплату ${fmt(r.measurer_fee)} замерщику ${r.measurer_name ?? ''}?`)) act(r, { action: 'fee_paid' }, 'Выплата отмечена.') }}
                        disabled={busy === r.id}
                        className="text-[11px] font-semibold bg-emerald-600 text-white rounded-lg px-2 py-1 hover:bg-emerald-700 disabled:opacity-40">💰 Выплачено</button>
                    )}
                  </div>
                  {r.issue_text && <p className="text-[12px] text-red-600 mt-1">⚠️ {r.issue_text}{r.issue_solution ? ` → 💡 ${r.issue_solution}` : ''}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
