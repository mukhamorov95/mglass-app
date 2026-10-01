'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildMeasureMessage, formatMeasureWhen, tidy } from '@/lib/measure/message'
import { sendMeasure } from '@/lib/measure/client'
import { confirmDialog } from '@/lib/dialog'
import MeasureBoard from '@/components/measure/MeasureBoard'
import BookingPicker, { type BookingValue } from '@/components/measure/BookingPicker'
import { STATUS_META, type MeasureMe, type MeasureReq, type MeasurerLite } from '@/components/measure/types'

// Новая заявка на замер — в порядке, в каком менеджер думает:
//  0) новый замер или повторный — обязательно: в аналитике они не смешиваются
//     (владелец 01.10). Повторный ссылается на прежний замер; по телефону форма
//     сама находит, где мы уже были;
//  1) есть текст из amo или переписки — вставь или надиктуй, поля заполнятся сами;
//  2) обязательное: клиент, телефон, адрес, что мерить;
//  3) когда: в пул (замерщик договорится сам) или назначить в свободное окно;
//  4) выезд: сумма и кто платит; гонорар — как выезд, если не сказано иначе;
//  5) дополнительное (№ заказа, amo) и «как увидит замерщик» — свёрнуто.

type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: { results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null
  onend: (() => void) | null; onerror: (() => void) | null
  start: () => void; stop: () => void
}

type Fields = {
  client_name: string; phone: string; address: string; scope: string; notes: string
  visit_price: string; payer: string; fee: string
  deal_number: string; amo_url: string
  kind: '' | 'new' | 'repeat'; repeat_of: number | null
}
const EMPTY: Fields = {
  client_name: '', phone: '', address: '', scope: '', notes: '',
  visit_price: '', payer: '', fee: '', deal_number: '', amo_url: '', kind: '', repeat_of: null,
}
const PAYERS = ['клиент на объекте', 'компания', 'в договоре']
const DRAFT_KEY = 'mglass_measure_request_draft_v2'
const OLD_DRAFT_KEY = 'mglass_measure_request_draft'
const EMPTY_BOOKING: BookingValue = { measurerId: '', date: '', time: '', durationMin: 90, travelMin: 60 }
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

export default function NewMeasureRequest({ me, measurers, onCreated, onClose }: {
  me: MeasureMe
  measurers: MeasurerLite[]
  onCreated: (req: MeasureReq, text: string) => void
  onClose: () => void
}) {
  const recRef = useRef<SpeechRec | null>(null)
  const [raw, setRaw] = useState('')
  const [f, setFields] = useState<Fields>(EMPTY)
  const [recording, setRecording] = useState(false)
  const [speechOk, setSpeechOk] = useState(true)
  const [parsing, setParsing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [when, setWhen] = useState<'pool' | 'book'>('pool')
  const [booking, setBooking] = useState<BookingValue>(EMPTY_BOOKING)
  const [feeOpen, setFeeOpen] = useState(false)
  const [restored, setRestored] = useState(false)
  const [found, setFound] = useState<{ digits: string; rows: MeasureReq[] }>({ digits: '', rows: [] })

  // Черновик переживает перезагрузку, пока заявку не создали и не закрыли форму.
  useEffect(() => {
    try {
      let d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as { raw?: string; f?: Partial<Fields> } | null
      // Черновик прежней формы (до 01.10) — подхватываем, чтобы не потерять начатое.
      const old = !d ? JSON.parse(localStorage.getItem(OLD_DRAFT_KEY) ?? 'null') as { rawText?: string; fields?: (Partial<Fields> & { is_repeat?: boolean }) | null; fee?: string } | null : null
      if (old) {
        const { is_repeat, ...rest } = old.fields ?? {}
        d = { raw: old.rawText, f: { ...rest, fee: old.fee ?? '', kind: is_repeat ? 'repeat' : '' } }
        localStorage.removeItem(OLD_DRAFT_KEY)
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (d?.raw) setRaw(d.raw)
      if (d?.f) { setFields({ ...EMPTY, ...d.f }); if (d.f.fee) setFeeOpen(true) }
    } catch { /* нет хранилища — без черновика */ }
    setRestored(true)
  }, [])
  useEffect(() => {
    if (!restored) return
    try {
      const empty = !raw && Object.entries(f).every(([k, v]) => v === EMPTY[k as keyof Fields])
      if (empty) localStorage.removeItem(DRAFT_KEY)
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ raw, f }))
    } catch { /* нет хранилища */ }
  }, [raw, f, restored])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (measurers.length === 1) setBooking(b => b.measurerId ? b : { ...b, measurerId: measurers[0].id }) }, [measurers])

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setFields(p => ({ ...p, [k]: v }))

  // Были ли мы уже у этого клиента — по телефону (последние 7 цифр, в любом написании).
  const phoneDigits = f.phone.replace(/\D/g, '')
  useEffect(() => {
    if (phoneDigits.length < 10) return
    let alive = true
    const t = setTimeout(async () => {
      const res = await fetch(`/api/measure-requests?q=${phoneDigits.slice(-7)}`, { cache: 'no-store' }).catch(() => null)
      const j = res && res.ok ? await res.json().catch(() => null) : null
      const rows = ((j?.requests ?? []) as MeasureReq[]).filter(r => r.status !== 'cancelled').slice(0, 5)
      if (alive) setFound({ digits: phoneDigits, rows })
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [phoneDigits])
  const prev = phoneDigits.length >= 10 && found.digits === phoneDigits ? found.rows : []
  const prevLabel = (r: MeasureReq) =>
    `${r.deal_number ? `${r.deal_number} · ` : ''}${tidy(r.client_name)} · ${new Date(r.scheduled_at ?? r.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short' })} · ${STATUS_META[r.status]?.label ?? r.status}`
  const price = Number(f.visit_price.replace(/\s/g, '')) || 0

  function toggleRecording() {
    if (recording) { recRef.current?.stop(); return }
    const W = window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec }
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Ctor) { setSpeechOk(false); return }
    const rec = new Ctor()
    rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = false
    rec.onresult = e => {
      let t = ''
      for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript + ' '
      if (t.trim()) setRaw(prev => (prev ? prev + ' ' : '') + t.trim())
    }
    rec.onend = () => setRecording(false)
    rec.onerror = () => setRecording(false)
    recRef.current = rec; rec.start(); setRecording(true)
  }

  async function parse() {
    if (!raw.trim()) return
    setParsing(true); setError('')
    try {
      const res = await fetch('/api/ai/parse-measure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: raw }),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok || r.error) { setError(r.error || `Не удалось разобрать (${res.status}) — заполни поля руками`); return }
      // Разобранное дополняет введённое руками, а не затирает его.
      setFields(p => ({
        ...p,
        client_name: p.client_name || (r.client_name ?? ''),
        phone: p.phone || (r.phone ?? ''),
        address: p.address || (r.address ?? ''),
        scope: p.scope || (r.scope ?? ''),
        notes: p.notes || (r.notes ?? ''),
        visit_price: p.visit_price || (r.visit_price ? String(r.visit_price) : ''),
        payer: p.payer || (r.payer ?? ''),
        deal_number: p.deal_number || (r.deal_number ?? ''),
        amo_url: p.amo_url || (r.amo_url ?? ''),
        // «Повторный» в тексте — подставляем; «новый» сам текст не доказывает, выбирает менеджер.
        kind: p.kind || (r.is_repeat ? 'repeat' : ''),
      }))
    } finally { setParsing(false) }
  }

  const missing = [
    !f.kind && 'новый или повторный',
    !f.client_name.trim() && 'клиента',
    !f.phone.trim() && 'телефон',
    !f.address.trim() && 'адрес',
    !f.scope.trim() && 'что мерить',
    when === 'book' && (!booking.measurerId || !booking.date || !booking.time) && 'замерщика и время',
  ].filter(Boolean) as string[]

  const preview = useMemo(() => buildMeasureMessage({
    ...f, is_repeat: f.kind === 'repeat', visit_price: price, manager_name: me.name,
  }), [f, price, me.name])

  async function create() {
    if (missing.length) return
    setSending(true); setError('')
    try {
      const body: Record<string, unknown> = {
        client_name: f.client_name, phone: f.phone, address: f.address, scope: f.scope, notes: f.notes,
        visit_price: f.visit_price, payer: f.payer, measurer_fee: feeOpen && f.fee.trim() ? f.fee : undefined,
        deal_number: f.deal_number, amo_url: f.amo_url, raw_text: raw || null,
        is_repeat: f.kind === 'repeat', repeat_of: f.kind === 'repeat' ? f.repeat_of : null,
      }
      if (when === 'book') {
        body.booking = { measurer_id: booking.measurerId, date: booking.date, time: booking.time, duration_min: booking.durationMin, travel_min: booking.travelMin }
      }
      const r = await sendMeasure<{ request: MeasureReq }>('/api/measure-requests', 'POST', body,
        b => ({ ...b, booking: { ...(b.booking as Record<string, unknown>), force: true } }))
      if (!r.ok) { if (!r.cancelled) setError(r.error); return }
      const req = r.data.request
      try { localStorage.removeItem(DRAFT_KEY) } catch { /* нет хранилища */ }
      onCreated(req, req.scheduled_at
        ? `Замер назначен: ${formatMeasureWhen(req.scheduled_at, req.duration_min)} · ${req.measurer_name}. Он в колонке «Назначены» и в кабинете замерщика.`
        : 'Заявка в колонке «Ждут замерщика» — замерщики видят её в своём кабинете и назначат время.')
    } finally { setSending(false) }
  }

  async function close() {
    const dirty = raw || Object.entries(f).some(([k, v]) => v !== EMPTY[k as keyof Fields])
    if (dirty && !(await confirmDialog({ title: 'Закрыть новую заявку?', text: 'Введённое будет стёрто.', confirmLabel: 'Закрыть', danger: true }))) return
    try { localStorage.removeItem(DRAFT_KEY) } catch { /* нет хранилища */ }
    onClose()
  }

  const inp = 'w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]'
  const lbl = 'text-[11px] font-semibold text-[#6b6b66] block mb-1'
  const step = 'text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]'
  const chip = (on: boolean) => `text-[12px] rounded-lg px-3 py-1.5 border ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:bg-[#f5f5f3]'}`

  return (
    <div className="bg-white rounded-xl border border-[#111110] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-bold">Новая заявка на замер</p>
        <button onClick={close} className="text-[12px] text-[#9a9a95] hover:text-[#111110]">✕ Закрыть</button>
      </div>

      {/* 0. Новый или повторный — в аналитике не смешиваются */}
      <div className="space-y-2">
        <p className={step}>Какой замер *</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setFields(p => ({ ...p, kind: 'new', repeat_of: null }))} className={chip(f.kind === 'new')}>
            📐 Новый — объект, где ещё не были
          </button>
          <button type="button" onClick={() => set('kind', 'repeat')} className={chip(f.kind === 'repeat')}>
            🔁 Повторный — доснять или перемерить
          </button>
        </div>
        {f.kind === 'repeat' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-[#6b6b66]">Повторный к замеру:</span>
            <select value={f.repeat_of ?? ''} onChange={e => set('repeat_of', e.target.value ? Number(e.target.value) : null)}
              className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] max-w-full">
              <option value="">{prev.length ? '— выбери —' : 'введи телефон клиента — найду прежний замер'}</option>
              {prev.map(r => <option key={r.id} value={r.id}>{prevLabel(r)}</option>)}
            </select>
          </div>
        )}
        {f.kind !== 'repeat' && prev.length > 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-2 text-[12px] flex flex-wrap items-center gap-2">
            <span>У этого клиента уже был замер: <b>{prevLabel(prev[0])}</b>{prev.length > 1 ? ` и ещё ${prev.length - 1}` : ''}. Едем доснять — это повторный.</span>
            <button type="button" onClick={() => setFields(p => ({ ...p, kind: 'repeat', repeat_of: prev[0].id }))}
              className="rounded-lg px-2 py-1 border border-blue-300 bg-white hover:bg-blue-50">🔁 Да, повторный к нему</button>
          </div>
        )}
      </div>

      {/* 1. Текст из amo / переписки / голос */}
      <div className="rounded-lg bg-[#fafaf8] border border-[#f0f0ec] p-3 space-y-2">
        <p className="text-[12px] text-[#4b4b47]">Есть текст из amo или переписки? Вставь или надиктуй — поля ниже заполнятся сами.</p>
        <textarea value={raw} onChange={e => setRaw(e.target.value)} rows={3}
          placeholder={'0123-4 Иван +79001234567, г Москва ЖК Пример корп. 3, кв. 138.\nДушевая перегородка, зеркало в чёрной раме. Выезд 3000, платит компания'}
          className={inp} />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={parse} disabled={parsing || !raw.trim()}
            className="text-[12px] font-semibold bg-[#111110] text-white rounded-lg px-3 py-1.5 hover:bg-[#2a2a28] disabled:opacity-40">
            {parsing ? 'Разбираю…' : '🧠 Заполнить поля из текста'}
          </button>
          <button onClick={toggleRecording}
            className={`text-[12px] font-semibold rounded-lg px-3 py-1.5 border ${recording ? 'bg-red-600 text-white border-red-600 animate-pulse' : 'border-[#e4e4e0] hover:bg-[#f5f5f3]'}`}>
            {recording ? '■ Стоп' : '🎤 Надиктовать'}
          </button>
          {!speechOk && <span className="text-[11px] text-amber-700">Голос не поддерживается браузером — вставь текст.</span>}
        </div>
      </div>

      {/* 2. Кто, где, что */}
      <div className="space-y-2">
        <p className={step}>Клиент и объект</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={lbl}>Клиент *</label>
            <input value={f.client_name} onChange={e => set('client_name', e.target.value)} placeholder="Анна" className={inp} /></div>
          <div><label className={lbl}>Телефон *</label>
            <input value={f.phone} onChange={e => set('phone', e.target.value)} inputMode="tel" placeholder="+7 900 123-45-67" className={inp} /></div>
          <div className="sm:col-span-2"><label className={lbl}>Адрес *</label>
            <input value={f.address} onChange={e => set('address', e.target.value)} placeholder="Москва, ул. Примерная, 1, кв. 10" className={inp} /></div>
          <div className="sm:col-span-2"><label className={lbl}>Что мерить * — каждое изделие с новой строки</label>
            <textarea value={f.scope} onChange={e => set('scope', e.target.value)} rows={3}
              placeholder={'Душевая перегородка\nЗеркало в чёрной алюминиевой раме\nЗеркало с подсветкой, отверстия под смеситель'}
              className={`${inp} resize-y`} /></div>
          <div className="sm:col-span-2"><label className={lbl}>Примечание для замерщика</label>
            <input value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="связь через жену, домофон 12, удобно после 18:00" className={inp} /></div>
        </div>
      </div>

      {/* 3. Когда */}
      <div className="space-y-2">
        <p className={step}>Когда</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setWhen('pool')} className={chip(when === 'pool')}>🆕 В пул — замерщик сам договорится с клиентом</button>
          <button type="button" onClick={() => setWhen('book')} className={chip(when === 'book')}>📅 Уже договорились — назначить</button>
        </div>
        {when === 'book' && (measurers.length === 0
          ? <p className="text-[12px] text-amber-700">Замерщики ещё не заведены в приложении — назначить некого, заявка уйдёт в пул.</p>
          : (
            <div className="space-y-2">
              <BookingPicker value={booking} onChange={setBooking} measurers={measurers} />
              <MeasureBoard title="Свободные окна — нажми, чтобы подставить" refreshKey={0}
                pick={{
                  durationMin: booking.durationMin,
                  selected: booking.measurerId && booking.date && booking.time ? { measurerId: booking.measurerId, measurerName: '', date: booking.date, time: booking.time } : null,
                  onPick: p => setBooking(b => ({ ...b, measurerId: p.measurerId, date: p.date, time: p.time })),
                }} />
            </div>
          ))}
      </div>

      {/* 4. Выезд */}
      <div className="space-y-2">
        <p className={step}>Выезд</p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={f.visit_price} onChange={e => set('visit_price', e.target.value)} inputMode="numeric" placeholder="2500"
            className={`${inp} w-28 font-mono`} />
          <span className="text-[12px] text-[#6b6b66]">₽ · платит</span>
          {PAYERS.map(p => (
            <button key={p} type="button" onClick={() => set('payer', f.payer === p ? '' : p)} className={chip(f.payer === p)}>{p}</button>
          ))}
          {f.payer && !PAYERS.includes(f.payer) && <span className="text-[12px] text-[#4b4b47]">«{f.payer}»</span>}
        </div>
        {!feeOpen ? (
          <p className="text-[12px] text-[#6b6b66]">
            Гонорар замерщика — как выезд{price > 0 ? ` (${fmt(price)})` : ''}.{' '}
            <button type="button" onClick={() => setFeeOpen(true)} className="text-blue-700 hover:underline">Другой</button>
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#6b6b66]">Гонорар замерщика:</span>
            <input value={f.fee} onChange={e => set('fee', e.target.value)} inputMode="numeric" placeholder={price ? String(price) : 'сумма'} className={`${inp} w-28 font-mono`} />
            <span className="text-[12px] text-[#6b6b66]">₽</span>
            <button type="button" onClick={() => { setFeeOpen(false); set('fee', '') }} className="text-[12px] text-[#9a9a95]">как выезд</button>
          </div>
        )}
      </div>

      {/* 5. Дополнительно и предпросмотр — свёрнуто */}
      <details className="rounded-lg border border-[#f0f0ec] px-3 py-2">
        <summary className="text-[12px] text-[#4b4b47] cursor-pointer">Дополнительно: № заказа, ссылка amo</summary>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          <div><label className={lbl}>№ заказа</label>
            <input value={f.deal_number} onChange={e => set('deal_number', e.target.value)} placeholder="0008-6" className={inp} /></div>
          <div><label className={lbl}>Ссылка amo</label>
            <input value={f.amo_url} onChange={e => set('amo_url', e.target.value)} placeholder="https://mglass.amocrm.ru/leads/detail/…" className={inp} /></div>
        </div>
      </details>
      <details className="rounded-lg border border-[#f0f0ec] px-3 py-2">
        <summary className="text-[12px] text-[#4b4b47] cursor-pointer">Так увидит замерщик</summary>
        <pre className="mt-2 bg-[#fafaf8] rounded-lg p-3 text-[12px] whitespace-pre-wrap font-sans">{preview}</pre>
      </details>

      {error && <p className="text-[12px] text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={create} disabled={sending || missing.length > 0}
          className="text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-40">
          {sending ? '…' : when === 'book' ? '✅ Создать и назначить' : '✅ Создать заявку'}
        </button>
        {missing.length > 0 && <span className="text-[12px] text-amber-700">Заполни: {missing.join(', ')}</span>}
      </div>
    </div>
  )
}
