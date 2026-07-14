'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'

type SpeechRec = {
  start: () => void; stop: () => void; lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null; onerror: (() => void) | null
}

// «Необходимо купить» — канбан заявок цеха на расходники/инструмент.
// Колонки: Необходимо купить → Заказано → Приехал на склад. Фиксируем кто и когда
// создал / заказал / принял. Внутри карточки — обсуждение (где и что купить).

type Req = {
  id: number
  title: string
  details: string | null
  link_url: string | null
  qty: string | null
  status: 'need' | 'ordered' | 'arrived'
  expected_date: string | null
  author_name: string
  ordered_by: string | null
  ordered_at: string | null
  arrived_by: string | null
  arrived_at: string | null
  created_at: string
}
type Comment = { id: number; request_id: number; author_name: string; text: string; created_at: string }

const COLS: { key: Req['status']; label: string; hdr: string }[] = [
  { key: 'need',    label: 'Необходимо купить', hdr: 'text-red-600' },
  { key: 'ordered', label: 'Заказано',          hdr: 'text-blue-700' },
  { key: 'arrived', label: 'Приехал на склад',  hdr: 'text-emerald-700' },
]

const fmtD = (d: string | null) => d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

export default function BuyPage() {
  const sb = createClient()
  const [me, setMe] = useState<{ id: string; name: string } | null>(null)
  const [reqs, setReqs] = useState<Req[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'new' | 'work' | 'done'>('work')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  // Новая заявка
  const [nTitle, setNTitle] = useState('')
  const [nQty, setNQty] = useState('')
  const [nLink, setNLink] = useState('')
  const [nDetails, setNDetails] = useState('')

  // Голосовой ввод заявки
  const [recording, setRecording] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const recRef = useRef<SpeechRec | null>(null)

  async function parseVoice(text: string) {
    setParsing(true)
    try {
      const r = await fetch('/api/ai/parse-purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).then(x => x.json())
      if (r.title) setNTitle(r.title)
      if (r.qty) setNQty(r.qty)
      if (r.link) setNLink(r.link)
      if (r.details) setNDetails(r.details)
    } catch { /* оставим текст, заполнят вручную */ } finally { setParsing(false) }
  }

  function toggleRec() {
    if (recording) { recRef.current?.stop(); return }
    const W = window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec }
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Ctor) { alert('Голосовой ввод не поддерживается этим браузером. Введите вручную.'); return }
    const rec = new Ctor()
    rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = false
    let acc = ''
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) acc += e.results[i][0].transcript + ' '
      setVoiceText(acc.trim())
    }
    rec.onend = () => { setRecording(false); if (acc.trim()) parseVoice(acc.trim()) }
    rec.onerror = () => setRecording(false)
    recRef.current = rec; rec.start(); setRecording(true)
  }

  // Комментарий
  const [cText, setCText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: profile } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
      setMe({ id: user.id, name: profile?.name ?? user.email ?? 'Сотрудник' })
    }
    const [{ data: r }, { data: c }] = await Promise.all([
      sb.from('shop_purchase_requests').select('*').order('id', { ascending: false }).limit(300),
      sb.from('shop_purchase_comments').select('*').order('created_at', { ascending: true }).limit(1000),
    ])
    setReqs((r ?? []) as Req[])
    setComments((c ?? []) as Comment[])
    setLoading(false)
  }, [sb])

  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  async function createReq() {
    if (!me || !nTitle.trim()) return
    setBusy(true)
    try {
      const { error } = await sb.from('shop_purchase_requests').insert({
        title: nTitle.trim(), qty: nQty.trim() || null, link_url: nLink.trim() || null,
        details: nDetails.trim() || null, author_id: me.id, author_name: me.name,
      })
      if (!error) {
        // уведомление закупщику в Telegram — не блокирует создание заявки
        fetch('/api/shop-purchases/notify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: nTitle.trim(), qty: nQty.trim(), author: me.name, link: nLink.trim() }),
        }).catch(() => {})
        setNTitle(''); setNQty(''); setNLink(''); setNDetails(''); setTab('work'); load()
      }
    } finally { setBusy(false) }
  }

  async function moveTo(req: Req, status: Req['status']) {
    if (!me) return
    setBusy(true)
    try {
      const patch: Record<string, unknown> = { status }
      const now = new Date().toISOString()
      if (status === 'ordered') { patch.ordered_by = me.name; patch.ordered_at = now }
      if (status === 'arrived') { patch.arrived_by = me.name; patch.arrived_at = now }
      if (status === 'need')    { patch.ordered_by = null; patch.ordered_at = null; patch.arrived_by = null; patch.arrived_at = null }
      await sb.from('shop_purchase_requests').update(patch).eq('id', req.id)
      load()
    } finally { setBusy(false) }
  }

  // Дата прибытия: мастер видит «едет к …» в своей очереди и в «Нужен материал»
  async function setExpected(reqId: number, date: string | null) {
    await sb.from('shop_purchase_requests').update({ expected_date: date }).eq('id', reqId)
    load()
  }

  async function addComment(reqId: number) {
    if (!me || !cText.trim()) return
    setBusy(true)
    try {
      await sb.from('shop_purchase_comments').insert({ request_id: reqId, author_id: me.id, author_name: me.name, text: cText.trim() })
      setCText('')
      load()
    } finally { setBusy(false) }
  }

  const active = reqs.filter(r => r.status !== 'arrived')
  const done   = reqs.filter(r => r.status === 'arrived')

  function card(r: Req) {
    const isOpen = expanded === r.id
    const cms = comments.filter(c => c.request_id === r.id)
    return (
      <div key={r.id} className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
        <button className="w-full text-left px-3.5 py-3" onClick={() => setExpanded(isOpen ? null : r.id)}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-bold text-[#111110]">{r.title}{r.qty ? <span className="font-normal text-[#6b6b66]"> · {r.qty}</span> : ''}</p>
            {cms.length > 0 && <span className="text-[10px] text-[#9a9a95] flex-shrink-0">💬 {cms.length}</span>}
          </div>
          <p className="text-[11px] text-[#9a9a95] mt-0.5">{r.author_name} · {fmtD(r.created_at)}</p>
          {r.status === 'ordered' && r.ordered_by && (
            <p className="text-[11px] text-blue-700 mt-0.5">
              заказал: {r.ordered_by} · {fmtD(r.ordered_at)}
              {r.expected_date && ` · 🚚 приедет к ${new Date(r.expected_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`}
            </p>
          )}
          {r.status === 'arrived' && r.arrived_by && <p className="text-[11px] text-emerald-700 mt-0.5">принял: {r.arrived_by} · {fmtD(r.arrived_at)}</p>}
        </button>
        {isOpen && (
          <div className="border-t border-[#f0f0ec] px-3.5 py-3 space-y-2.5 bg-[#fafaf9]">
            {r.details && <p className="text-[12px] text-[#333]">{r.details}</p>}
            {r.link_url && (
              <a href={r.link_url} target="_blank" rel="noopener noreferrer"
                className="inline-block text-[12px] text-blue-600 underline break-all">🔗 Ссылка на товар</a>
            )}
            {/* Перевод статуса */}
            <div className="flex gap-1.5 flex-wrap">
              {r.status === 'need' && (
                <button onClick={() => moveTo(r, 'ordered')} disabled={busy}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">✓ Заказано</button>
              )}
              {r.status === 'ordered' && (<>
                <button onClick={() => moveTo(r, 'arrived')} disabled={busy}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">✓ Приехал на склад</button>
                <button onClick={() => moveTo(r, 'need')} disabled={busy}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-white disabled:opacity-40">↩ Вернуть</button>
                <label className="flex items-center gap-1.5 text-[12px] text-[#6b6b66]">
                  приедет к:
                  <input type="date" defaultValue={r.expected_date ?? ''}
                    onBlur={e => { const v = e.target.value; if (v !== (r.expected_date ?? '')) setExpected(r.id, v || null) }}
                    className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] bg-white" />
                </label>
              </>)}
              {r.status === 'arrived' && (
                <button onClick={() => moveTo(r, 'ordered')} disabled={busy}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-white disabled:opacity-40">↩ Вернуть в «Заказано»</button>
              )}
            </div>
            {/* Обсуждение */}
            <div className="space-y-1.5">
              {cms.map(c => (
                <div key={c.id} className="bg-white rounded-lg border border-[#f0f0ec] px-2.5 py-1.5">
                  <p className="text-[12px] text-[#111110]">{c.text}</p>
                  <p className="text-[10px] text-[#9a9a95] mt-0.5">{c.author_name} · {fmtD(c.created_at)}</p>
                </div>
              ))}
              <div className="flex gap-1.5">
                <input value={expanded === r.id ? cText : ''} onChange={e => setCText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addComment(r.id) }}
                  placeholder="Написать в обсуждение…"
                  className="flex-1 bg-white border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#111110]" />
                <button onClick={() => addComment(r.id)} disabled={busy || !cText.trim()}
                  className="text-[12px] font-semibold px-3 rounded-lg bg-[#111110] text-white disabled:opacity-40">➤</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Необходимо купить</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Закончился расходник или нужен инструмент — оставь заявку. {active.length} в работе · {done.length} выполнено</p>
        <ProductionTabs />
        <div className="flex gap-1.5 mt-2 pt-2 border-t border-[#f0f0ec]">
          {([['new', '+ Новая заявка'], ['work', 'Заявки в работе'], ['done', 'Выполненные']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors ${tab === k ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4">
        {tab === 'new' && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-4 space-y-2.5 max-w-[560px]">
            <p className="text-[13px] font-bold text-[#111110]">Новая заявка</p>
            <div className="border border-dashed border-[#d8d8d3] rounded-lg p-3 bg-[#fafaf9]">
              <p className="text-[12px] text-[#6b6b66] mb-2">Наговори, что нужно купить — разложу по полям. Потом проверь и нажми «Создать заявку».</p>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={toggleRec} disabled={parsing}
                  className={`px-3 py-1.5 text-[13px] font-semibold rounded-lg disabled:opacity-50 ${recording ? 'bg-red-600 text-white' : 'bg-[#111110] text-white hover:bg-[#2a2a28]'}`}>
                  {recording ? '⏹ Стоп' : '🎤 Наговорить'}
                </button>
                {parsing && <span className="text-[12px] text-[#6b6b66]">🧠 Разбираю…</span>}
                {voiceText && !parsing && <span className="text-[12px] text-[#9a9a95] truncate max-w-[300px]">{voiceText}</span>}
              </div>
            </div>
            <input value={nTitle} onChange={e => setNTitle(e.target.value)} placeholder="Что нужно купить? (напр. «Свёрла по стеклу 6 мм»)"
              className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
            <div className="flex gap-2">
              <input value={nQty} onChange={e => setNQty(e.target.value)} placeholder="Кол-во (напр. 5 шт)"
                className="w-40 bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
              <input value={nLink} onChange={e => setNLink(e.target.value)} placeholder="Ссылка на товар (необязательно)"
                className="flex-1 bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
            </div>
            <textarea value={nDetails} onChange={e => setNDetails(e.target.value)} rows={2} placeholder="Детали: зачем, какое именно, чем заменить…"
              className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] resize-none" />
            <button onClick={createReq} disabled={busy || !nTitle.trim()}
              className="w-full bg-[#111110] text-white text-[14px] font-semibold py-2.5 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
              Создать заявку
            </button>
          </div>
        )}

        {tab === 'work' && (
          loading ? <p className="text-[13px] text-[#9a9a95]">Загрузка…</p> : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {COLS.map(col => {
                const list = (col.key === 'arrived' ? reqs.filter(r => r.status === 'arrived').slice(0, 5) : active.filter(r => r.status === col.key))
                return (
                  <div key={col.key}>
                    <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${col.hdr}`}>{col.label} · {list.length}</p>
                    <div className="space-y-2">
                      {list.length === 0 && <div className="rounded-xl border border-dashed border-[#d4d4cf] p-4 text-center text-[12px] text-[#c4c4be]">пусто</div>}
                      {list.map(card)}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {tab === 'done' && (
          <div className="space-y-2 max-w-[560px]">
            {done.length === 0 && <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center text-[13px] text-[#c4c4be]">Выполненных заявок пока нет</div>}
            {done.map(card)}
          </div>
        )}
      </div>
    </div>
  )
}
