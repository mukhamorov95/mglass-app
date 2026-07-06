'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Заявки на замер (вкладка менеджера): диктовка/вставка → AI-структура →
// заявка в пул замерщиков. Ниже — мои заявки и календарь занятости замерщиков.

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
  address: string | null
  scope: string | null
  visit_price: number
  payer: string | null
  is_repeat: boolean
  structured_text: string | null
  manager_id: string | null
  manager_name: string | null
  measurer_name: string | null
  scheduled_at: string | null
  status: string
  issue_text: string | null
  created_at: string
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  new:       { label: '🆕 Ждёт замерщика', cls: 'bg-amber-50 text-amber-700' },
  scheduled: { label: '📅 Назначен',       cls: 'bg-blue-50 text-blue-700' },
  done:      { label: '✅ Выполнен',       cls: 'bg-emerald-50 text-emerald-700' },
  issue:     { label: '⚠️ Сложность',      cls: 'bg-red-50 text-red-700' },
  cancelled: { label: 'Отменён',           cls: 'bg-[#f0f0ec] text-[#c4c4be]' },
}
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'

export default function MeasureRequestsPage() {
  const sb = createClient()
  const recRef = useRef<SpeechRec | null>(null)
  const [me, setMe] = useState<{ id: string; name: string; role: string } | null>(null)
  const [recording, setRecording] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(true)
  const [rawText, setRawText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [sending, setSending] = useState(false)
  const [parsed, setParsed] = useState<Record<string, unknown> | null>(null)
  const [fee, setFee] = useState('')
  const [reqs, setReqs] = useState<MReq[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: p } = await sb.from('users').select('id, name, role').eq('id', user.id).maybeSingle()
      if (p) setMe(p as { id: string; name: string; role: string })
    }
    const { data } = await sb.from('measure_requests')
      .select('id, deal_number, client_name, phone, address, scope, visit_price, payer, is_repeat, structured_text, manager_id, manager_name, measurer_name, scheduled_at, status, issue_text, created_at')
      .order('created_at', { ascending: false }).limit(200)
    setReqs((data ?? []) as MReq[])
    setLoading(false)
  }, [sb])

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
      if (!r.error) {
        setParsed(r)
        if (!fee) setFee(String(r.visit_price || ''))
      }
    } finally { setParsing(false) }
  }

  async function createRequest() {
    if (!me || !parsed) return
    setSending(true)
    try {
      const { error } = await sb.from('measure_requests').insert({
        deal_number: parsed.deal_number ?? null,
        client_name: parsed.client_name ?? '',
        phone: parsed.phone ?? null,
        amo_url: parsed.amo_url ?? null,
        address: parsed.address ?? null,
        scope: parsed.scope ?? null,
        notes: parsed.notes ?? null,
        visit_price: Number(parsed.visit_price) || 0,
        payer: parsed.payer ?? null,
        is_repeat: !!parsed.is_repeat,
        raw_text: rawText,
        structured_text: parsed.structured_text ?? null,
        manager_id: me.id, manager_name: me.name,
        measurer_fee: Number(fee.replace(/\s/g, '')) || 0,
      })
      if (!error) { setRawText(''); setParsed(null); setFee(''); await load() }
    } finally { setSending(false) }
  }

  // Календарь занятости: неделя вперёд, все назначенные замеры
  const week = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getTime() + i * 86400000)
      const next = new Date(d.getTime() + 86400000)
      const items = reqs.filter(r => r.scheduled_at && r.status === 'scheduled')
        .filter(r => { const t = new Date(r.scheduled_at!); return t >= d && t < next })
        .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
      return { d, items }
    })
  }, [reqs])

  const myReqs = useMemo(() =>
    me && me.role === 'manager' ? reqs.filter(r => r.manager_id === me.id) : reqs,
  [reqs, me])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Заявки на замер</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Надиктуй или вставь текст заявки — AI соберёт структуру. Замерщик увидит заявку в своём кабинете и назначит время.</p>
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1100px]">
        {/* Новая заявка */}
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
            className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
          <div className="flex items-center gap-2 mt-2">
            <button onClick={parse} disabled={parsing || !rawText.trim()}
              className="text-[12px] font-semibold border border-[#e4e4e0] rounded-lg px-3 py-1.5 hover:bg-[#f5f5f3] disabled:opacity-40">
              {parsing ? '🧠 Разбираю…' : '🧠 Разобрать AI'}
            </button>
            {parsed && (
              <>
                <label className="text-[12px] text-[#6b6b66] ml-2">Гонорар замерщика, ₽
                  <input value={fee} onChange={e => setFee(e.target.value)}
                    className="ml-2 w-24 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] font-mono text-blue-700 text-right" />
                </label>
                <button onClick={createRequest} disabled={sending}
                  className="ml-auto text-[12px] font-semibold bg-emerald-600 text-white rounded-lg px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-40">
                  {sending ? '…' : '✅ Создать заявку'}
                </button>
              </>
            )}
          </div>
          {parsed && (
            <pre className="mt-3 bg-[#fafaf8] border border-[#f0f0ec] rounded-lg p-3 text-[12px] whitespace-pre-wrap font-sans">{String(parsed.structured_text ?? '')}</pre>
          )}
        </div>

        {/* Календарь занятости */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">Календарь замеров · неделя</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {week.map(({ d, items }) => (
              <div key={d.toISOString()} className="border border-[#f0f0ec] rounded-lg p-2.5">
                <p className="text-[11px] font-bold capitalize">{d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                {items.length === 0 ? <p className="text-[11px] text-[#c4c4be] mt-1">свободно</p> : (
                  <div className="mt-1 space-y-1">
                    {items.map(r => (
                      <p key={r.id} className="text-[11px] text-[#6b6b66]">
                        <span className="font-mono font-semibold">{new Date(r.scheduled_at!).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                        {' '}{r.measurer_name || '—'} · {r.client_name}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

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
                      {r.structured_text && (
                        <button onClick={() => navigator.clipboard.writeText(r.structured_text!)}
                          className="ml-auto text-[11px] border border-[#e4e4e0] rounded-lg px-2 py-1 hover:bg-[#f5f5f3]">📋 Копировать</button>
                      )}
                    </div>
                    {r.address && <p className="text-[12px] text-[#6b6b66] mt-1">📍 {r.address}</p>}
                    {r.scope && <p className="text-[12px] text-[#6b6b66]">{r.scope}</p>}
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
