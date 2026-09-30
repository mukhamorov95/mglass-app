'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildMeasureMessage, splitScope } from '@/lib/measure/message'

// Заявки на замер (вкладка менеджера): диктовка/вставка → AI-структура →
// редактируемая форма (или ручной ввод с нуля) → заявка в пул замерщиков.
// Календарь занятости — отдельная страница /measure-calendar.

type SpeechRec = {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: { results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null
  onend: (() => void) | null; onerror: (() => void) | null
  start: () => void; stop: () => void
}

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
  structured_text: string | null
  manager_id: string | null
  manager_name: string | null
  measurer_name: string | null
  scheduled_at: string | null
  duration_min: number | null
  status: string
  issue_text: string | null
  created_at: string
}

type Fields = {
  deal_number: string
  client_name: string
  phone: string
  amo_url: string
  address: string
  scope: string
  notes: string
  visit_price: string
  payer: string
  is_repeat: boolean
}

const EMPTY_FIELDS: Fields = {
  deal_number: '', client_name: '', phone: '', amo_url: '',
  address: '', scope: '', notes: '', visit_price: '', payer: '', is_repeat: false,
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  new:       { label: '🆕 Ждёт замерщика', cls: 'bg-amber-50 text-amber-700' },
  scheduled: { label: '📅 Назначен',       cls: 'bg-blue-50 text-blue-700' },
  done:      { label: '✅ Выполнен',       cls: 'bg-emerald-50 text-emerald-700' },
  issue:     { label: '⚠️ Сложность',      cls: 'bg-red-50 text-red-700' },
  cancelled: { label: 'Отменён',           cls: 'bg-[#f0f0ec] text-[#c4c4be]' },
}

export default function MeasureRequestsPage() {
  const recRef = useRef<SpeechRec | null>(null)
  const [me, setMe] = useState<{ id: string; name: string; role: string; scope: string; canCreate: boolean } | null>(null)
  const [recording, setRecording] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(true)
  const [rawText, setRawText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [sending, setSending] = useState(false)
  const [fields, setFields] = useState<Fields | null>(null)
  const [fee, setFee] = useState('')
  const [reqs, setReqs] = useState<MReq[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<number | null>(null)

  // Список уже отфильтрован сервером по кругу видимости: менеджер получает свои
  // заявки, владелец и офис — все.
  const load = useCallback(async () => {
    const res = await fetch('/api/measure-requests', { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(j.error || `Заявки не загрузились (${res.status})`)
    else { setMe(j.me); setReqs(j.requests as MReq[]) }
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  function toggleRecording() {
    if (recording) { recRef.current?.stop(); return }
    const W = window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec }
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Ctor) { setSpeechSupported(false); return }
    const rec = new Ctor()
    rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = false
    rec.onresult = e => {
      let t = ''
      for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript + ' '
      if (t.trim()) setRawText(prev => (prev ? prev + ' ' : '') + t.trim())
    }
    rec.onend = () => setRecording(false)
    rec.onerror = () => setRecording(false)
    recRef.current = rec; rec.start(); setRecording(true)
  }

  async function parse() {
    if (!rawText.trim()) return
    setParsing(true)
    try {
      const r = await fetch('/api/ai/parse-measure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText }),
      }).then(x => x.json())
      if (r.error) setError(r.error)
      else {
        setError('')
        setFields({
          deal_number: r.deal_number ?? '',
          client_name: r.client_name ?? '',
          phone: r.phone ?? '',
          amo_url: r.amo_url ?? '',
          address: r.address ?? '',
          scope: r.scope ?? '',
          notes: r.notes ?? '',
          visit_price: r.visit_price ? String(r.visit_price) : '',
          payer: r.payer ?? '',
          is_repeat: !!r.is_repeat,
        })
        if (!fee && r.visit_price) setFee(String(r.visit_price))
      }
    } finally { setParsing(false) }
  }

  const structured = useMemo(() => fields ? buildMeasureMessage({
    ...fields,
    visit_price: Number(fields.visit_price.replace(/\s/g, '')) || 0,
    manager_name: me?.name,
  }) : '', [fields, me])

  async function createRequest() {
    if (!me || !fields || !fields.client_name.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/measure-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, raw_text: rawText || null, measurer_fee: fee.trim() || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || `Заявка не создана (${res.status})`); return }
      setError(''); setRawText(''); setFields(null); setFee(''); await load()
    } finally { setSending(false) }
  }

  // Текст собирается из заявки в момент копирования: в нём текущее время и
  // замерщик, и так же выглядят заявки, созданные из карточки сделки или лида.
  async function copyMessage(r: MReq) {
    try {
      await navigator.clipboard.writeText(buildMeasureMessage(r))
      setCopied(r.id)
      setTimeout(() => setCopied(c => (c === r.id ? null : c)), 2000)
    } catch {
      setError('Не удалось скопировать — браузер не дал доступ к буферу обмена.')
    }
  }

  function setF<K extends keyof Fields>(k: K, v: Fields[K]) {
    setFields(prev => prev ? { ...prev, [k]: v } : prev)
  }

  const myReqs = reqs

  const inputCls = 'w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]'
  const labelCls = 'text-[11px] font-semibold text-[#6b6b66] block mb-1'

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Заявки на замер</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Надиктуй или вставь текст — AI соберёт структуру, её можно поправить. Или заполни форму вручную. Занятость замерщиков — в «Календаре замеров».</p>
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1100px]">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] rounded-lg px-3 py-2 flex items-start gap-2">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-700">✕</button>
          </div>
        )}
        {/* Новая заявка: диктовка/вставка */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Новая заявка</p>
            <button onClick={toggleRecording}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg ${recording ? 'bg-red-600 text-white animate-pulse' : 'bg-[#111110] text-white hover:bg-[#2a2a28]'}`}>
              {recording ? '■ Стоп' : '🎤 Говорить'}
            </button>
          </div>
          {!speechSupported && <p className="text-[11px] text-amber-600 mb-2">Голос не поддерживается этим браузером — вставь текст.</p>}
          <textarea value={rawText} onChange={e => setRawText(e.target.value)} rows={5}
            placeholder={'Вставь или надиктуй, например:\n0008-6\nГалина +79514418341\nhttps://mglass.amocrm.ru/leads/detail/…\nАдрес: ул. Булатниковская 9к1\nЗеркало осветлённое 900×2200 от стены до зелёной зоны, думает о подсветке\nВыезд 2500, платит Галина'}
            className={inputCls} />
          <div className="flex items-center gap-2 mt-2">
            <button onClick={parse} disabled={parsing || !rawText.trim()}
              className="text-[12px] font-semibold border border-[#e4e4e0] rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3] disabled:opacity-40">
              {parsing ? '🧠 Разбираю…' : '🧠 Разобрать AI'}
            </button>
            {!fields && (
              <button onClick={() => setFields({ ...EMPTY_FIELDS })}
                className="text-[12px] font-semibold border border-[#e4e4e0] rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3]">
                ✍️ Заполнить вручную
              </button>
            )}
          </div>
        </div>

        {/* Структура заявки — редактируемая форма */}
        {fields && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Структура заявки</p>
              <button onClick={() => setFields(null)}
                className="text-[11px] text-[#9a9a95] hover:text-[#111110]">✕ Закрыть</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>№ заказа</label>
                <input value={fields.deal_number} onChange={e => setF('deal_number', e.target.value)} placeholder="0008-6" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Клиент *</label>
                <input value={fields.client_name} onChange={e => setF('client_name', e.target.value)} placeholder="Галина" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Телефон</label>
                <input value={fields.phone} onChange={e => setF('phone', e.target.value)} placeholder="+79514418341" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Amo-ссылка</label>
                <input value={fields.amo_url} onChange={e => setF('amo_url', e.target.value)} placeholder="https://mglass.amocrm.ru/…" className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Адрес *</label>
                <input value={fields.address} onChange={e => setF('address', e.target.value)} placeholder="ул. Булатниковская, 9к1" className={inputCls} />
              </div>
              <div className="sm:col-span-2 lg:row-span-2">
                <label className={labelCls}>Что мерить — каждое изделие с новой строки</label>
                <textarea value={fields.scope} onChange={e => setF('scope', e.target.value)} rows={4}
                  placeholder={'Душевая перегородка\nЗеркало в чёрной алюминиевой раме\nЗеркало с подсветкой, отверстия под смеситель'}
                  className={`${inputCls} resize-y`} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Примечание (через кого связь, доступ, этаж, время)</label>
                <input value={fields.notes} onChange={e => setF('notes', e.target.value)} placeholder="связь через Пашу, домофон 12, после 18:00" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Выезд, ₽</label>
                <input value={fields.visit_price} onChange={e => setF('visit_price', e.target.value)} placeholder="2500" className={`${inputCls} font-mono text-blue-700`} />
              </div>
              <div>
                <label className={labelCls}>Платит</label>
                <input value={fields.payer} onChange={e => setF('payer', e.target.value)} placeholder="Галина / включено в договор" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Гонорар замерщика, ₽</label>
                <input value={fee} onChange={e => setFee(e.target.value)} placeholder={fields.visit_price || '= выезд'} className={`${inputCls} font-mono text-blue-700`} />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-[12px] text-[#6b6b66] cursor-pointer">
                  <input type="checkbox" checked={fields.is_repeat} onChange={e => setF('is_repeat', e.target.checked)} className="accent-[#111110]" />
                  🔁 Повторный замер
                </label>
              </div>
            </div>

            <p className="mt-3 text-[11px] font-semibold text-[#6b6b66]">Так увидит замерщик</p>
            <pre className="mt-1 bg-[#fafaf8] border border-[#f0f0ec] rounded-lg p-3 text-[12px] whitespace-pre-wrap font-sans">{structured}</pre>

            <div className="flex items-center gap-2 mt-3">
              <button onClick={createRequest} disabled={sending || !fields.client_name.trim() || !fields.address.trim()}
                className="text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-40">
                {sending ? '…' : '✅ Создать заявку'}
              </button>
              {(!fields.client_name.trim() || !fields.address.trim()) && (
                <span className="text-[11px] text-amber-600">{!fields.client_name.trim() ? 'Укажи имя клиента' : 'Укажи адрес — замерщику некуда ехать без него'}</span>
              )}
            </div>
          </div>
        )}

        {/* Мои заявки */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">Заявки ({myReqs.length})</p>
          {myReqs.length === 0 ? <p className="text-[12px] text-[#c4c4be]">Пока нет.</p> : (
            <div className="space-y-2">
              {myReqs.map(r => {
                const meta = STATUS_META[r.status] ?? STATUS_META.new
                return (
                  <div key={r.id} className="border border-[#f0f0ec] rounded-lg p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold">{r.is_repeat ? '🔁' : '📐'} {r.deal_number || `#${r.id}`} · {r.client_name}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.label}</span>
                      {r.scheduled_at && <span className="text-[11px] text-[#6b6b66]">🕐 {new Date(r.scheduled_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {r.measurer_name || ''}</span>}
                      <button onClick={() => copyMessage(r)}
                        className={`ml-auto text-[11px] border rounded-lg px-2 py-1 ${copied === r.id ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[#e4e4e0] hover:bg-[#f5f5f3]'}`}>
                        {copied === r.id ? '✓ Скопировано — вставь замерщику' : '📋 Копировать замерщику'}
                      </button>
                    </div>
                    {r.address && <p className="text-[12px] text-[#6b6b66] mt-1">📍 {r.address}</p>}
                    {splitScope(r.scope).length > 0 && (
                      <ol className="text-[12px] text-[#6b6b66] list-decimal pl-5 mt-0.5">
                        {splitScope(r.scope).map((it, i) => <li key={i}>{it}</li>)}
                      </ol>
                    )}
                    {r.issue_text && <p className="text-[12px] text-red-600 mt-1">⚠️ {r.issue_text}</p>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
