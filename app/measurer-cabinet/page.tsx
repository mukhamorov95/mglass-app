'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildMeasureResultMessage, clientHeadsUpText, dayRouteUrl, formatMeasureWhen, splitScope, tidy, whatsAppUrl } from '@/lib/measure/message'
import { mskDate } from '@/lib/measure/slots'
import { mskToday, sendMeasure } from '@/lib/measure/client'
import { confirmDialog } from '@/lib/dialog'
import { telHref } from '@/lib/b2c/phoneKey'
import MeasureBoard from '@/components/measure/MeasureBoard'
import MeasurerAvailability from '@/components/measure/MeasurerAvailability'
import BookingPicker, { type BookingValue } from '@/components/measure/BookingPicker'
import SettleForm from '@/components/measure/SettleForm'
import MeasurerEarnings from '@/components/measure/MeasurerEarnings'
import MeasurerCalendar from '@/components/measure/MeasurerCalendar'
import OwnerSummary from '@/components/measure/OwnerSummary'
import type { VisitPayment } from '@/lib/measure/money'

// Кабинет замерщика, две вкладки. «Замеры»: сегодня (куда ехать, кому звонить, что
// мерить) → пул новых заявок («Взять» в своё свободное окно) → дальше по дням →
// занятость всех замерщиков → мой график. «Заработок»: период, оплаты, гонорар.
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
  travel_min: number | null
  status: string
  issue_text: string | null
  issue_solution: string | null
  measurer_fee: number
  fee_status: string
  actual_price: number | null
  price_note: string | null
  visit_payment: VisitPayment | null
  result_note: string | null
  photos: string[] | null
  created_at: string
}
type Tab = 'measures' | 'earnings' | 'calendar'
type Me = { id: string; name: string; role: string; scope: string }

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const byTime = (a: MReq, b: MReq) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '')
const WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MONTH = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const dayTitle = (date: string) => { const d = new Date(`${date}T00:00:00Z`); return `${WEEKDAY[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}` }
const EMPTY_BOOKING: BookingValue = { measurerId: '', date: '', time: '', durationMin: 90, travelMin: 60 }

export default function MeasurerCabinetPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [reqs, setReqs] = useState<MReq[]>([])
  const [measurers, setMeasurers] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Только что закрытый замер — из плашки его итог копируется в тему группы «…замер готов».
  const [doneId, setDoneId] = useState<number | null>(null)
  const [copiedDone, setCopiedDone] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [boardKey, setBoardKey] = useState(0)
  const [tab, setTab] = useState<Tab>('measures')
  // Открытая форма у карточки: взять/перенести (booking) или сложность (issue).
  const [openFor, setOpenFor] = useState<{ id: number; kind: 'book' | 'issue' | 'done' } | null>(null)
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
  // Ссылки …/measurer-cabinet#earnings и #calendar открывают сразу нужную вкладку.
  useEffect(() => {
    const h = window.location.hash.slice(1)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (h === 'earnings' || h === 'calendar') setTab(h)
  }, [])
  function switchTab(t: Tab) {
    setTab(t)
    try { history.replaceState(null, '', t === 'measures' ? window.location.pathname : `#${t}`) } catch { /* без адресной строки */ }
  }

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

  const doneReq = doneId != null ? reqs.find(r => r.id === doneId && r.status === 'done') ?? null : null
  async function copyDone() {
    if (!doneReq) return
    try {
      await navigator.clipboard.writeText(buildMeasureResultMessage(doneReq))
      setCopiedDone(true)
    } catch { setError('Не удалось скопировать — браузер не дал доступ к буферу обмена.') }
  }

  async function act(r: MReq, body: Record<string, unknown>, done?: string) {
    setBusy(r.id); setError(''); setNotice(''); setDoneId(null)
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
      date: at.slice(0, 10) || today, time: at.slice(11, 16), durationMin: r.duration_min || 90, travelMin: r.travel_min ?? 60,
    })
  }

  async function submitBooking(r: MReq) {
    const label = `${dayTitle(bookVal.date)}, ${bookVal.time}`
    await act(r, { action: 'schedule', measurer_id: bookVal.measurerId, date: bookVal.date, time: bookVal.time, duration_min: bookVal.durationMin, travel_min: bookVal.travelMin },
      r.status === 'new'
        ? `Заявка ${r.deal_number || `#${r.id}`} взята: ${label}. Она в «Дальше» и на доске — менеджер видит время.`
        : `Замер перенесён на ${label}.`)
  }

  // Фото и чертежи с объекта — сразу пачкой. По одному и по очереди: сервер дописывает
  // ссылку в массив заявки, параллельные загрузки затёрли бы друг друга.
  async function attachFiles(r: MReq, files: File[]) {
    setBusy(r.id); setError(''); setNotice('')
    let ok = 0
    try {
      for (const file of files) {
        const fd = new FormData(); fd.append('file', file)
        const res = await fetch(`/api/measure-requests/${r.id}/photo`, { method: 'POST', body: fd })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError(`${file.name}: ${j.error || `не загружен (${res.status})`}${ok ? ` — до него загружено ${ok}` : ''}`)
          break
        }
        ok++
      }
      if (ok) setNotice(`Приложено файлов: ${ok} к замеру ${r.deal_number || `#${r.id}`} — менеджер видит их в заявке и в карточке сделки.`)
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
          💰 выезд {Number(r.visit_price) > 0 ? fmt(Number(r.visit_price)) : 'цена не указана'}
          {r.actual_price != null && <> → <b className="text-[#111110]">{fmt(Number(r.actual_price))}</b>{r.price_note ? ` (${r.price_note})` : ''}</>}
          {r.payer ? ` · платит ${r.payer}` : ''}
          {' · '}гонорар {Number(r.measurer_fee) > 0 ? fmt(Number(r.measurer_fee)) : 'не указан'}
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
          <span className="text-[13px] font-semibold">{r.is_repeat ? '🔁 Повторный · ' : '📐 '}{r.deal_number || `#${r.id}`} · {tidy(r.client_name)}</span>
          {isOwner && r.measurer_name && <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f0ec] text-[#4b4b47]">📏 {r.measurer_name}</span>}
          {r.status === 'issue' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700">⚠️ сложность</span>}
        </div>
        {details(r)}
        {r.issue_text && <p className="text-[12px] text-red-600 mt-1">⚠️ {r.issue_text}{r.issue_solution ? ` → 💡 ${r.issue_solution}` : ''}</p>}
        {Array.isArray(r.photos) && r.photos.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {r.photos.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="text-[12px] text-blue-700 hover:underline">📎 файл {i + 1}</a>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <button onClick={() => setOpenFor({ id: r.id, kind: 'done' })}
            className="text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-emerald-700">✅ Выполнен</button>
          <button onClick={() => { setOpenFor({ id: r.id, kind: 'issue' }); setIssueText(r.issue_text ?? ''); setIssueSol(r.issue_solution ?? '') }}
            className={`${btn} text-red-600 border-red-200`}>⚠️ Сложность</button>
          <label className={`${btn} cursor-pointer`}>
            📎 Фото / чертёж
            <input type="file" accept="image/*,application/pdf" multiple className="hidden"
              onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length) attachFiles(r, fs); e.target.value = '' }} />
          </label>
          {(() => {
            const wa = r.scheduled_at ? whatsAppUrl(r.phone, clientHeadsUpText({ measurer_name: r.measurer_name, scheduled_at: r.scheduled_at, address: r.address, today })) : null
            return wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className={`${btn} text-emerald-700`}
                title="Откроется WhatsApp с готовым текстом: кто, когда и по какому адресу">💬 Предупредить клиента</a>
            )
          })()}
          {canBook && <button onClick={() => openBooking(r)} className={btn}>↔ Перенести</button>}
          <button onClick={async () => { if (await confirmDialog({ title: 'Вернуть заявку в пул?', text: 'Время снимется, заявка снова станет новой для всех замерщиков.', confirmLabel: 'Вернуть в пул' })) act(r, { action: 'unassign' }, 'Заявка вернулась в пул.') }}
            className={btn}>↩ В пул</button>
        </div>
        {open && openFor?.kind === 'book' && bookingForm(r, '✅ Перенести')}
        {open && openFor?.kind === 'done' && (
          <SettleForm r={r} mode="done" onCancel={() => setOpenFor(null)}
            onDone={msg => { setOpenFor(null); setNotice(msg); setDoneId(r.id); setCopiedDone(false); void load() }} />
        )}
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
        <div className="flex gap-1 mt-3 -mb-4 overflow-x-auto">
          {([['measures', '📏 Замеры'], ['earnings', '💰 Заработок'], ['calendar', '📅 Календарь']] as const).map(([k, l]) => (
            <button key={k} onClick={() => switchTab(k)}
              className={`text-[13px] font-semibold px-4 py-2 border-b-2 ${tab === k ? 'border-[#111110] text-[#111110]' : 'border-transparent text-[#9a9a95] hover:text-[#111110]'}`}>
              {l}
            </button>
          ))}
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
            {doneReq && (
              <button onClick={copyDone} className="text-[11px] font-semibold border border-emerald-300 bg-white rounded-lg px-2 py-1 hover:bg-emerald-100 shrink-0">
                {copiedDone ? '✓ Скопировано' : `📋 В тему «${doneReq.is_repeat ? 'Повторный' : 'Новый'} замер готов»`}
              </button>
            )}
            <button onClick={() => { setNotice(''); setDoneId(null) }} className="text-emerald-500 hover:text-emerald-800">✕</button>
          </div>
        )}
        {tab === 'earnings' && me && <MeasurerEarnings meId={me.id} isOwner={isOwner} />}
        {tab === 'calendar' && me && <MeasurerCalendar meId={me.id} isOwner={isOwner} refreshKey={boardKey} onChanged={() => setBoardKey(k => k + 1)} />}
        {tab === 'measures' && <>
        {isOwner && <OwnerSummary refreshKey={boardKey} />}
        {isOwner && measurers.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
            В приложении нет пользователей с ролью «Замерщик» — брать заявки и вести график некому. Заведи замерщиков в «Пользователях» с ролью «Замерщик».
          </div>
        )}

        {overdue.length > 0 && (
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-red-700">Прошли, но не отмечены · {overdue.length}</p>
            {overdue.map(activeCard)}
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Сегодня, {dayTitle(today)} · {todays.length}</p>
            {isMeasurer && (() => {
              const route = dayRouteUrl(todays.filter(r => r.status === 'scheduled').map(r => r.address))
              return route && (
                <a href={route} target="_blank" rel="noopener noreferrer"
                  className="ml-auto text-[12px] font-semibold bg-[#111110] text-white rounded-lg px-3 py-1.5 hover:bg-[#2a2a28]">🗺 Маршрут дня</a>
              )
            })()}
          </div>
          {todays.length === 0 ? <p className="text-[12px] text-[#c4c4be]">На сегодня замеров нет.</p> : todays.map(activeCard)}
        </section>

        <section className={`rounded-xl border p-4 ${pool.length ? 'bg-amber-50 border-amber-200' : 'bg-white border-[#e4e4e0]'}`}>
          <p className={`text-[11px] font-bold uppercase tracking-widest ${pool.length ? 'text-amber-700' : 'text-[#9a9a95]'}`}>🆕 Новые заявки — ждут замерщика · {pool.length}</p>
          {pool.length === 0 ? <p className="text-[12px] text-[#c4c4be] mt-1">Пул пуст.</p> : (
            <div className="mt-2 space-y-2">
              {pool.map(r => (
                <div key={r.id} className={`bg-white border border-amber-100 rounded-lg p-3 ${busy === r.id ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold">{r.is_repeat ? '🔁 Повторный · ' : '📐 '}{r.deal_number || `#${r.id}`} · {tidy(r.client_name)}</span>
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
              <p className="text-[12px] font-bold first-letter:uppercase text-[#4b4b47]">{dayTitle(d)} · {items.length}</p>
              {items.map(activeCard)}
            </div>
          ))}
        </section>

        <MeasureBoard title="Все замерщики — занятость" refreshKey={boardKey} />
        <MeasurerAvailability onChanged={() => setBoardKey(k => k + 1)} />

        </>}
      </div>
    </div>
  )
}
