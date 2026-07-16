'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'

type Lead = {
  id: number
  source: 'avito' | 'call' | 'whatsapp' | 'site' | 'referral' | 'manual'
  name: string | null; phone: string | null; city: string | null; address: string | null
  order_no: string | null; product: string | null; sizes: string | null; budget: string | null
  est_amount: number | null; est_profit: number | null
  stage: string; qualified: boolean; score: number | null; score_reason: string | null
  manager: string | null; note: string | null
  status: 'active' | 'won' | 'lost'; lost_reason: string | null
  avito_chat_id: string | null; created_at: string; updated_at: string
}
type Ev = { id: number; lead_id: number; kind: string; text: string; author: string | null; created_at: string }
type ThreadMsg = { id: string; from: 'us' | 'client'; text: string; created: number }

const STAGES = [
  'Получена новая заявка', 'Замер назначен', 'Замер проведён', 'Согласование после замера',
  'Чертежи в работу', 'Согласование после отправки чертежей', 'КП отправлено', 'Счёт выставлен — ждём оплату',
]
const SOURCE_LABEL: Record<string, string> = {
  avito: 'Авито', call: 'Звонок', whatsapp: 'WhatsApp', site: 'Сайт', referral: 'Рекомендация', manual: 'Вручную',
}
const AI_MANAGERS = ['Иван (AI)', 'AI-менеджер', 'Максим']

function fmtD(s: string) { return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }
const RUB = (n: number) => n.toLocaleString('ru-RU')

function Field({ label, value, onSave, isNum, placeholder }: {
  label: string; value: string | number | null; onSave: (v: string | number | null) => void; isNum?: boolean; placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  function start() { setDraft(value == null ? '' : String(value)); setEditing(true) }
  function commit() {
    setEditing(false)
    const nv = isNum ? (draft.trim() === '' ? null : Number(draft.replace(/[^\d.-]/g, ''))) : (draft.trim() || null)
    if (nv !== value) onSave(nv)
  }
  return (
    <div className="flex items-baseline gap-2 py-1.5 border-b border-[#f0f0ec]">
      <span className="text-[11px] text-[#9a9a95] w-[92px] shrink-0">{label}</span>
      {editing ? (
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="flex-1 text-[13px] border border-[#0071e3] rounded px-2 py-1 outline-none" />
      ) : (
        <button onClick={start} className="flex-1 text-left text-[13px] text-[#111110] hover:bg-[#fafaf9] rounded px-2 py-1 -mx-2">
          {value != null && value !== '' ? String(value) : <span className="text-[#c4c4be]">{placeholder ?? 'указать'}</span>}
        </button>
      )}
    </div>
  )
}

export default function LeadDetailPage() {
  const params = useParams()
  const id = Number(params.id)
  const sb = createClient()

  const [lead, setLead] = useState<Lead | null>(null)
  const [events, setEvents] = useState<Ev[]>([])
  const [thread, setThread] = useState<ThreadMsg[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadErr, setThreadErr] = useState('')
  const [me, setMe] = useState('')
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')      // сообщение клиенту
  const [note, setNote] = useState('')        // внутреннее примечание
  const [sending, setSending] = useState(false)
  const [calling, setCalling] = useState(false)
  const [flash, setFlash] = useState('')

  const loadEvents = useCallback(async () => {
    const { data } = await sb.from('crm_lead_events').select('*').eq('lead_id', id).order('id', { ascending: false }).limit(80)
    setEvents((data ?? []) as Ev[])
  }, [sb, id])

  const loadThread = useCallback(async (l: Lead) => {
    if (l.source !== 'avito' || !l.avito_chat_id) { setThread([]); return }
    setThreadLoading(true); setThreadErr('')
    try {
      const r = await fetch(`/api/avito/thread?lead_id=${l.id}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      setThread((d.messages ?? []) as ThreadMsg[])
    } catch (e) { setThreadErr((e as Error).message) }
    finally { setThreadLoading(false) }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: p } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
      setMe((p as { name: string | null } | null)?.name ?? user.email ?? '')
    }
    const { data } = await sb.from('crm_leads').select('*').eq('id', id).maybeSingle()
    const l = data as Lead | null
    setLead(l)
    setLoading(false)
    if (l) { loadEvents(); loadThread(l) }
  }, [sb, id, loadEvents, loadThread])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  function toast(t: string) { setFlash(t); setTimeout(() => setFlash(''), 2500) }

  async function patch(p: Partial<Lead>, eventText?: string, kind = 'system') {
    await sb.from('crm_leads').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id)
    setLead(l => (l ? { ...l, ...p } : l))
    if (eventText) { await sb.from('crm_lead_events').insert({ lead_id: id, kind, text: eventText, author: me || null }); loadEvents() }
  }

  async function sendToClient() {
    if (!lead || !draft.trim()) return
    setSending(true)
    try {
      const r = await fetch('/api/avito/thread', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: id, text: draft.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      setDraft('')
      await loadThread(lead); loadEvents()
      if (d.tookOver) setLead(l => (l ? { ...l, manager: me } : l))
    } catch (e) { toast('Не отправлено: ' + (e as Error).message) }
    finally { setSending(false) }
  }

  async function addNote() {
    if (!note.trim()) return
    await sb.from('crm_lead_events').insert({ lead_id: id, kind: 'note', text: note.trim(), author: me || null })
    setNote(''); loadEvents()
  }

  async function callClient() {
    if (!lead?.phone) return
    setCalling(true)
    try {
      const r = await fetch('/api/sipuni/call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: id }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      toast('Звоним — SIPUNI сейчас наберёт вас, затем клиента'); loadEvents()
    } catch (e) { toast('Звонок не удался: ' + (e as Error).message) }
    finally { setCalling(false) }
  }

  if (loading) return <div className="min-h-screen bg-[#f8f8f7] p-6 text-[13px] text-[#9a9a95]">Загрузка…</div>
  if (!lead) return (
    <div className="min-h-screen bg-[#f8f8f7] p-6">
      <Link href="/crm" className="text-[13px] text-[#0071e3]">← Воронка</Link>
      <p className="mt-4 text-[14px] text-[#111110]">Лид не найден.</p>
    </div>
  )

  const humanHandling = !!lead.manager && !AI_MANAGERS.includes(lead.manager)

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="max-w-[1200px] mx-auto px-4 py-5">
        {/* Шапка */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Link href="/crm" className="text-[13px] text-[#0071e3] hover:underline">← Воронка</Link>
            <h1 className="text-[18px] font-semibold text-[#111110]">{lead.qualified && '⭐ '}{lead.name || lead.order_no || `Лид #${lead.id}`}</h1>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f0ec] text-[#6b6b66]">{SOURCE_LABEL[lead.source]}</span>
            {lead.status === 'won' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Сделка</span>}
            {lead.status === 'lost' && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-600">Отказ</span>}
          </div>
          {flash && <span className="text-[12px] text-emerald-700">{flash}</span>}
        </div>

        <div className="grid lg:grid-cols-[360px_1fr] gap-4">
          {/* Левая колонка — поля */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 h-fit">
            {/* Этап */}
            <label className="text-[11px] text-[#9a9a95]">Этап</label>
            <select value={lead.stage} onChange={e => patch({ stage: e.target.value }, `Этап: ${lead.stage} → ${e.target.value}`, 'stage')}
              className="w-full mt-1 mb-3 border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] bg-white">
              {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
              {!STAGES.includes(lead.stage) && <option value={lead.stage}>{lead.stage}</option>}
            </select>

            <Field label="Номер заказа" value={lead.order_no} onSave={v => patch({ order_no: v as string | null })} placeholder="0000-0" />
            <Field label="Имя" value={lead.name} onSave={v => patch({ name: v as string | null })} />
            <Field label="Телефон" value={lead.phone} onSave={v => patch({ phone: v as string | null })} />
            {lead.phone && (
              <button onClick={callClient} disabled={calling}
                className="my-2 w-full px-3 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-50">
                {calling ? 'Звоню…' : '📞 Позвонить'}
              </button>
            )}
            <Field label="Город" value={lead.city} onSave={v => patch({ city: v as string | null })} />
            <Field label="Адрес" value={lead.address} onSave={v => patch({ address: v as string | null })} placeholder="адрес объекта" />
            <Field label="Продукт" value={lead.product} onSave={v => patch({ product: v as string | null })} />
            <Field label="Размеры" value={lead.sizes} onSave={v => patch({ sizes: v as string | null })} />
            <Field label="Бюджет" value={lead.budget} onSave={v => patch({ budget: v as string | null })} />
            <Field label="Предв.цена" value={lead.est_amount} onSave={v => patch({ est_amount: v as number | null })} isNum placeholder="₽" />
            <Field label="Менеджер" value={lead.manager} onSave={v => patch({ manager: v as string | null })} />

            {lead.score != null && <p className="mt-2 text-[11px] text-[#9a9a95]">Скоринг: {lead.score}/100{lead.score_reason ? ` — ${lead.score_reason}` : ''}</p>}

            <div className="flex gap-2 mt-3">
              <button onClick={() => patch({ qualified: !lead.qualified }, lead.qualified ? 'Снят с ключевого' : '⭐ Ключевой этап')}
                className={`flex-1 px-2 py-2 rounded-lg text-[12px] font-semibold border ${lead.qualified ? 'bg-amber-100 text-amber-800 border-amber-300' : 'border-[#e4e4e0] text-[#6b6b66]'}`}>
                ⭐ Ключевой
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              {lead.status === 'active' ? (
                <>
                  <button onClick={() => patch({ status: 'won' }, '✅ Сделка выиграна')} className="flex-1 px-2 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold">✅ Сделка</button>
                  <button onClick={() => { const r = prompt('Причина отказа?') ?? ''; patch({ status: 'lost', lost_reason: r || null }, `✖ Отказ${r ? `: ${r}` : ''}`) }} className="flex-1 px-2 py-2 rounded-lg border border-red-200 text-red-600 text-[12px] font-semibold">✖ Отказ</button>
                </>
              ) : (
                <button onClick={() => patch({ status: 'active', lost_reason: null }, '↩ Возвращён в работу')} className="flex-1 px-2 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[12px] font-semibold">↩ Вернуть в работу</button>
              )}
            </div>
            <p className="mt-3 text-[10px] text-[#c4c4be]">Создан {fmtD(lead.created_at)}</p>
          </div>

          {/* Правая колонка — переписка и примечания */}
          <div className="space-y-4">
            {/* Переписка с клиентом (Авито) */}
            {lead.source === 'avito' && lead.avito_chat_id && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[13px] font-semibold text-[#111110]">💬 Переписка с клиентом · Авито</p>
                  <span className={`text-[10px] ${humanHandling ? 'text-emerald-700' : 'text-[#9a9a95]'}`}>{humanHandling ? 'ведёте вы · Иван молчит' : 'отвечает Иван (AI)'}</span>
                </div>
                <div className="bg-[#fafaf9] rounded-lg p-2 max-h-[46vh] overflow-y-auto space-y-1.5">
                  {threadLoading && <p className="text-[12px] text-[#9a9a95] text-center py-4">Загрузка переписки…</p>}
                  {threadErr && <p className="text-[12px] text-red-600 text-center py-4">{threadErr}</p>}
                  {!threadLoading && !threadErr && thread.length === 0 && <p className="text-[12px] text-[#9a9a95] text-center py-4">Сообщений пока нет.</p>}
                  {thread.map(m => (
                    <div key={m.id} className={`flex ${m.from === 'us' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] whitespace-pre-wrap ${m.from === 'us' ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#111110]'}`}>{m.text}</div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 mt-2">
                  <input value={draft} onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && draft.trim() && !sending) sendToClient() }}
                    placeholder="Написать клиенту в Авито…" disabled={sending}
                    className="flex-1 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] disabled:opacity-50" />
                  <button onClick={sendToClient} disabled={sending || !draft.trim()} className="px-4 py-2 rounded-lg bg-[#0071e3] text-white text-[13px] font-medium disabled:opacity-40">{sending ? '…' : 'Клиенту'}</button>
                </div>
              </div>
            )}

            {/* Примечания (внутри) + лента */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[13px] font-semibold text-[#111110] mb-2">📝 Примечания и история <span className="text-[11px] text-[#9a9a95] font-normal">— клиент не видит</span></p>
              <div className="flex gap-1.5">
                <input value={note} onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && note.trim()) addNote() }}
                  placeholder="Примечание по лиду… (Enter)" className="flex-1 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
                <button onClick={addNote} disabled={!note.trim()} className="px-3 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66] text-[13px] disabled:opacity-40">＋</button>
              </div>
              <div className="mt-3 space-y-1.5 max-h-[40vh] overflow-y-auto">
                {events.map(ev => {
                  const isMsg = ev.kind === 'message'
                  const isClient = isMsg && ev.text.startsWith('КЛИЕНТ:')
                  const tone = ev.kind === 'note' ? 'bg-amber-50' : ev.kind === 'call' ? 'bg-blue-50' : isMsg ? (isClient ? 'bg-[#f2f2f0]' : 'bg-[#eef5ff]') : 'bg-[#fafaf9]'
                  return (
                    <div key={ev.id} className={`text-[12px] rounded-lg px-3 py-1.5 ${tone}`}>
                      <p className="text-[#111110] whitespace-pre-wrap">{ev.text}</p>
                      <p className="text-[10px] text-[#9a9a95]">{ev.author ?? ''} · {fmtD(ev.created_at)}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
