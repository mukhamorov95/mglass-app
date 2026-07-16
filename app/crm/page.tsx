'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'

// Собственная CRM (контур MGlass), фаза 1: воронка «Продажи» с каноническими
// этапами из SYSTEM.md (те же, что в AmoCRM — менеджерам ничего не переучивать).
// Лиды заводятся вручную и из Авито-бота (фаза 2); AmoCRM остаётся read-only
// архивом. «Ключевой этап» = квалифицирован: наш клиент, с ним работаем.

type Lead = {
  id: number
  source: 'avito' | 'call' | 'whatsapp' | 'site' | 'referral' | 'manual'
  name: string | null
  phone: string | null
  city: string | null
  product: string | null
  sizes: string | null
  budget: string | null
  est_amount: number | null
  est_profit: number | null
  stage: string
  qualified: boolean
  score: number | null
  score_reason: string | null
  manager: string | null
  note: string | null
  status: 'active' | 'won' | 'lost'
  lost_reason: string | null
  avito_chat_id: string | null
  created_at: string
  updated_at: string
}
type ThreadMsg = { id: string; from: 'us' | 'client'; text: string; created: number }
type Ev = { id: number; lead_id: number; kind: string; text: string; author: string | null; created_at: string }

// Воронка CRM = только ПРОДАЖА (решение владельца 15.07): квалификация и
// производство убраны — производство живёт в своих экранах. «Получена новая
// заявка» оставлена входом: сюда падают лиды Авито-бота и ручные.
// Имена этапов — канон SYSTEM.md; лиды с другими этапами (например, после
// переноса из amo) показываются в блоке «Прочие этапы».
const ZONES: { zone: string; tone: string; stages: string[] }[] = [
  { zone: 'Продажа', tone: 'text-amber-700', stages: [
    'Получена новая заявка',
    'Замер назначен', 'Замер проведён', 'Согласование после замера', 'Чертежи в работу',
    'Согласование после отправки чертежей', 'КП отправлено', 'Счёт выставлен — ждём оплату',
  ]},
]
const ALL_STAGES = ZONES.flatMap(z => z.stages)

const SOURCE_LABEL: Record<Lead['source'], string> = {
  avito: 'Авито', call: 'Звонок', whatsapp: 'WhatsApp', site: 'Сайт', referral: 'Рекомендация', manual: 'Вручную',
}
const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')
const fmtD = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const EMPTY = {
  source: 'manual' as Lead['source'], name: '', phone: '', city: '', product: '', sizes: '',
  budget: '', est_amount: '', est_profit: '', manager: '', note: '',
}

export default function CrmPage() {
  const sb = createClient()
  const [leads, setLeads] = useState<Lead[]>([])
  const [events, setEvents] = useState<Ev[]>([])
  const [thread, setThread] = useState<ThreadMsg[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadErr, setThreadErr] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [calling, setCalling] = useState(false)
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState('')
  const [openLead, setOpenLead] = useState<Lead | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [srcFilter, setSrcFilter] = useState<'all' | Lead['source']>('all')
  const [showClosed, setShowClosed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1800) }

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await sb.auth.getUser()
      if (user) {
        const { data: p } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
        setMe((p as { name: string | null } | null)?.name ?? user.email ?? '')
      }
      const { data } = await sb.from('crm_leads').select('*').order('updated_at', { ascending: false }).limit(500)
      setLeads((data ?? []) as Lead[])
    } finally { setLoading(false) }
  }, [sb])
  useEffect(() => { void load() }, [load])

  async function loadEvents(leadId: number) {
    const { data } = await sb.from('crm_lead_events').select('*').eq('lead_id', leadId).order('id', { ascending: false }).limit(50)
    setEvents((data ?? []) as Ev[])
  }

  async function loadThread(lead: Lead) {
    if (lead.source !== 'avito' || !lead.avito_chat_id) { setThread([]); setThreadErr(''); return }
    setThreadLoading(true); setThreadErr('')
    try {
      const r = await fetch(`/api/avito/thread?lead_id=${lead.id}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      setThread((d.messages ?? []) as ThreadMsg[])
    } catch (e) { setThreadErr((e as Error).message); setThread([]) }
    finally { setThreadLoading(false) }
  }

  function openCard(l: Lead) {
    setOpenLead(l); setDraft(''); loadEvents(l.id); loadThread(l)
  }

  async function sendMsg() {
    if (!openLead || !draft.trim()) return
    setSending(true)
    try {
      const r = await fetch('/api/avito/thread', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: openLead.id, text: draft.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      setDraft('')
      await loadThread(openLead)
      loadEvents(openLead.id)
      if (d.tookOver) load()  // менеджер стал ответственным — обновить карточку в воронке
    } catch (e) { flash('Не отправлено: ' + (e as Error).message) }
    finally { setSending(false) }
  }

  async function callClient() {
    if (!openLead?.phone) return
    setCalling(true)
    try {
      const r = await fetch('/api/sipuni/call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: openLead.id }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      flash('Звоним — SIPUNI сейчас наберёт вас, затем клиента')
      loadEvents(openLead.id)
    } catch (e) { flash('Звонок не удался: ' + (e as Error).message) }
    finally { setCalling(false) }
  }

  async function addEvent(leadId: number, kind: string, text: string) {
    await sb.from('crm_lead_events').insert({ lead_id: leadId, kind, text, author: me || null })
  }

  async function createLead() {
    if (!form.phone.trim() && !form.name.trim()) { flash('Имя или телефон обязательны'); return }
    const { data, error } = await sb.from('crm_leads').insert({
      source: form.source,
      name: form.name.trim() || null, phone: form.phone.trim() || null, city: form.city.trim() || null,
      product: form.product.trim() || null, sizes: form.sizes.trim() || null, budget: form.budget.trim() || null,
      est_amount: form.est_amount !== '' ? Number(form.est_amount) : null,
      est_profit: form.est_profit !== '' ? Number(form.est_profit) : null,
      manager: form.manager.trim() || me || null, note: form.note.trim() || null,
    }).select('id').single()
    if (error) { flash('Ошибка: ' + error.message); return }
    await addEvent((data as { id: number }).id, 'system', `Лид создан (${SOURCE_LABEL[form.source]})`)
    setFormOpen(false); setForm({ ...EMPTY }); flash('Лид создан'); load()
  }

  async function patchLead(id: number, patch: Partial<Lead>, eventText?: string) {
    await sb.from('crm_leads').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (eventText) await addEvent(id, patch.stage ? 'stage' : 'system', eventText)
    await load()
    if (openLead?.id === id) {
      const { data } = await sb.from('crm_leads').select('*').eq('id', id).single()
      setOpenLead(data as Lead)
      loadEvents(id)
    }
  }

  const q = search.trim().toLowerCase()
  const visible = leads.filter(l =>
    (showClosed ? true : l.status === 'active') &&
    (srcFilter === 'all' || l.source === srcFilter) &&
    (!q || (l.name ?? '').toLowerCase().includes(q) || (l.phone ?? '').includes(q) || (l.product ?? '').toLowerCase().includes(q))
  )
  const byStage = new Map<string, Lead[]>()
  for (const l of visible) byStage.set(l.stage, [...(byStage.get(l.stage) ?? []), l])

  const keyLeads = visible.filter(l => l.qualified && l.status === 'active')

  if (loading) return <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>

  const inputCls = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white outline-none focus:border-[#111110]'
  const lbl = 'text-[11px] font-medium text-[#6b6b66] mb-1 block'

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl shadow-lg text-[13px] font-semibold bg-[#111110] text-white">{toast}</div>}

      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">📊 CRM · Продажи</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">
              Активных: {leads.filter(l => l.status === 'active').length} · ⭐ ключевой этап: {keyLeads.length}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск: имя / телефон"
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white w-48 outline-none focus:border-[#111110]" />
            <select value={srcFilter} onChange={e => setSrcFilter(e.target.value as typeof srcFilter)}
              className="border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] bg-white">
              <option value="all">Все источники</option>
              {(Object.keys(SOURCE_LABEL) as Lead['source'][]).map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[12px] text-[#6b6b66]">
              <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} className="accent-[#111110]" />
              закрытые
            </label>
            <Link href="/crm/import" className="px-4 py-2.5 rounded-xl border border-[#e4e4e0] bg-white text-[#111110] text-[13px] font-semibold hover:bg-[#f5f5f3]">⬇ Импорт с Авито</Link>
            <button onClick={() => setFormOpen(true)} className="px-4 py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold hover:opacity-90">＋ Лид</button>
          </div>
        </div>
      </div>

      {/* Форма нового лида */}
      {formOpen && (
        <div className="mx-5 mt-4 bg-white rounded-xl border border-[#111110] p-4 space-y-3 max-w-[900px]">
          <p className="text-[13px] font-bold text-[#111110]">Новый лид</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <span className={lbl}>Источник</span>
              <select className={inputCls} value={form.source} onChange={e => setForm({ ...form, source: e.target.value as Lead['source'] })}>
                {(Object.keys(SOURCE_LABEL) as Lead['source'][]).map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
              </select>
            </div>
            <div><span className={lbl}>Имя</span><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><span className={lbl}>Телефон</span><input className={inputCls} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            <div><span className={lbl}>Город</span><input className={inputCls} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div><span className={lbl}>Продукт</span><input className={inputCls} value={form.product} onChange={e => setForm({ ...form, product: e.target.value })} placeholder="душевая / зеркало / лофт" /></div>
            <div><span className={lbl}>Размеры</span><input className={inputCls} value={form.sizes} onChange={e => setForm({ ...form, sizes: e.target.value })} /></div>
            <div><span className={lbl}>Предв. цена, ₽</span><input type="number" className={inputCls} value={form.est_amount} onChange={e => setForm({ ...form, est_amount: e.target.value })} /></div>
            <div><span className={lbl}>Менеджер</span><input className={inputCls} value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} placeholder={me} /></div>
          </div>
          <div><span className={lbl}>Заметка</span><input className={inputCls} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></div>
          <div className="flex gap-2">
            <button onClick={createLead} className="px-5 py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold">Создать</button>
            <button onClick={() => setFormOpen(false)} className="px-4 py-2.5 rounded-xl border border-[#e4e4e0] text-[13px] text-[#6b6b66]">Отмена</button>
          </div>
        </div>
      )}

      {/* Воронка: зоны → этапы → карточки */}
      <div className="px-5 pt-4 space-y-5">
        {/* Этапы вне канона (например, «отложенный спрос» из AmoCRM после переноса) */}
        {(() => {
          const extra = [...byStage.keys()].filter(s => !ALL_STAGES.includes(s))
          if (!extra.length) return null
          return (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2 text-[#9a9a95]">Прочие этапы · {extra.reduce((n, s) => n + (byStage.get(s)?.length ?? 0), 0)}</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {extra.map(st => {
                  const list = byStage.get(st) ?? []
                  return (
                    <div key={st} className="flex-shrink-0 w-60 rounded-xl border bg-white border-[#e4e4e0]">
                      <p className="px-3 py-2 text-[11px] font-semibold text-[#6b6b66] border-b border-[#f8f8f7]">{st} · {list.length}</p>
                      <div className="p-2 space-y-2">
                        {list.map(l => (
                          <button key={l.id} onClick={() => openCard(l)}
                            className="w-full text-left rounded-lg border border-[#eceff1] p-2.5 hover:border-[#111110]">
                            <p className="text-[12px] font-bold text-[#111110] truncate">{l.name || l.phone || `Лид #${l.id}`}</p>
                            <p className="text-[10px] text-[#9a9a95] mt-0.5">{l.manager ?? ''}{l.est_amount != null ? ` · ${RUB(Number(l.est_amount))} ₽` : ''}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {ZONES.map(z => {
          const zoneLeads = z.stages.reduce((s, st) => s + (byStage.get(st)?.length ?? 0), 0)
          return (
            <div key={z.zone}>
              <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${z.tone}`}>{z.zone} · {zoneLeads}</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {z.stages.map(st => {
                  const list = byStage.get(st) ?? []
                  return (
                    <div key={st} className={`flex-shrink-0 w-60 rounded-xl border bg-white ${list.length ? 'border-[#e4e4e0]' : 'border-[#f0f0ec] opacity-60'}`}>
                      <p className="px-3 py-2 text-[11px] font-semibold text-[#6b6b66] border-b border-[#f8f8f7]">{st} · {list.length}</p>
                      <div className="p-2 space-y-2 min-h-[40px]">
                        {list.map(l => (
                          <button key={l.id} onClick={() => openCard(l)}
                            className={`w-full text-left rounded-lg border p-2.5 hover:border-[#111110] transition-colors ${l.qualified ? 'border-amber-300 bg-amber-50/50' : 'border-[#eceff1]'}`}>
                            <p className="text-[12px] font-bold text-[#111110] truncate">
                              {l.qualified && '⭐ '}{l.name || l.phone || `Лид #${l.id}`}
                              {l.status === 'won' && ' ✅'}{l.status === 'lost' && ' ✖'}
                            </p>
                            <p className="text-[11px] text-[#6b6b66] truncate">{[l.product, l.sizes].filter(Boolean).join(' · ')}</p>
                            <p className="text-[10px] text-[#9a9a95] mt-0.5">
                              {SOURCE_LABEL[l.source]}{l.manager ? ` · ${l.manager}` : ''}{l.est_amount != null ? ` · ${RUB(Number(l.est_amount))} ₽` : ''}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Карточка лида */}
      {openLead && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={() => setOpenLead(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-xl max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[16px] font-bold text-[#111110]">{openLead.qualified && '⭐ '}{openLead.name || `Лид #${openLead.id}`}</p>
                <p className="text-[12px] text-[#6b6b66]">{SOURCE_LABEL[openLead.source]} · {fmtD(openLead.created_at)}{openLead.manager ? ` · ${openLead.manager}` : ''}</p>
              </div>
              <button onClick={() => setOpenLead(null)} className="text-[#9a9a95] text-[18px] leading-none px-1">✕</button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              {openLead.phone && (
                <p className="flex items-center gap-2">
                  <span className="text-[#9a9a95]">Телефон:</span>
                  <a href={`tel:${openLead.phone}`} className="text-blue-600">{openLead.phone}</a>
                  <button onClick={callClient} disabled={calling}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-50">
                    {calling ? 'Звоню…' : '📞 Позвонить'}
                  </button>
                </p>
              )}
              {!openLead.phone && openLead.source === 'avito' && (
                <p className="text-[11px] text-[#c4c4be]">📞 Звонок будет доступен, когда клиент оставит номер в переписке</p>
              )}
              {openLead.city && <p><span className="text-[#9a9a95]">Город:</span> {openLead.city}</p>}
              {openLead.product && <p><span className="text-[#9a9a95]">Продукт:</span> {openLead.product}</p>}
              {openLead.sizes && <p><span className="text-[#9a9a95]">Размеры:</span> {openLead.sizes}</p>}
              {openLead.budget && <p><span className="text-[#9a9a95]">Бюджет:</span> {openLead.budget}</p>}
              {openLead.est_amount != null && <p><span className="text-[#9a9a95]">Предв. цена:</span> {RUB(Number(openLead.est_amount))} ₽</p>}
              {openLead.est_profit != null && <p><span className="text-[#9a9a95]">Прибыль ≈</span> {RUB(Number(openLead.est_profit))} ₽</p>}
              {openLead.score != null && <p><span className="text-[#9a9a95]">Скоринг:</span> {openLead.score}/100{openLead.score_reason ? ` — ${openLead.score_reason}` : ''}</p>}
            </div>
            {openLead.note && <p className="mt-2 text-[12px] text-[#6b6b66] bg-[#fafaf9] rounded-lg px-3 py-2">{openLead.note}</p>}

            {/* Этап и ключевые действия */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <select value={openLead.stage}
                  onChange={e => patchLead(openLead.id, { stage: e.target.value }, `Этап: ${openLead.stage} → ${e.target.value}`)}
                  className="flex-1 border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] bg-white min-w-[220px]">
                  {!ALL_STAGES.includes(openLead.stage) && <option value={openLead.stage}>{openLead.stage} (вне канона)</option>}
                  {ALL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => patchLead(openLead.id, { qualified: !openLead.qualified }, openLead.qualified ? 'Снят с ключевого этапа' : '⭐ Ключевой этап: наш клиент')}
                  className={`px-3 py-2 rounded-lg text-[12px] font-semibold border ${openLead.qualified ? 'bg-amber-100 text-amber-800 border-amber-300' : 'border-[#e4e4e0] text-[#6b6b66] hover:border-amber-400'}`}>
                  ⭐ Ключевой
                </button>
              </div>
              {openLead.status === 'active' ? (
                <div className="flex gap-2">
                  <button onClick={() => patchLead(openLead.id, { status: 'won' }, '✅ Сделка выиграна')}
                    className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold">✅ Сделка</button>
                  <button onClick={() => { const r = prompt('Причина отказа?') ?? ''; patchLead(openLead.id, { status: 'lost', lost_reason: r || null }, `✖ Отказ${r ? `: ${r}` : ''}`) }}
                    className="flex-1 py-2 rounded-lg border border-red-200 text-red-600 text-[12px] font-semibold">✖ Отказ</button>
                </div>
              ) : (
                <button onClick={() => patchLead(openLead.id, { status: 'active', lost_reason: null }, '↩ Возвращён в работу')}
                  className="w-full py-2 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66]">↩ Вернуть в работу</button>
              )}
            </div>

            {/* Переписка с клиентом (Авито) */}
            {openLead.source === 'avito' && openLead.avito_chat_id && (
              <div className="mt-4 border-t border-[#f0f0ec] pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12px] font-semibold text-[#111110]">💬 Переписка · Авито</p>
                  {openLead.manager && !['Иван (AI)', 'AI-менеджер', 'Максим'].includes(openLead.manager)
                    ? <span className="text-[10px] text-emerald-700">диалог ведёте вы · Иван молчит</span>
                    : <span className="text-[10px] text-[#9a9a95]">отвечает Иван (AI)</span>}
                </div>
                <div className="bg-[#fafaf9] rounded-lg p-2 max-h-64 overflow-y-auto space-y-1.5">
                  {threadLoading && <p className="text-[12px] text-[#9a9a95] text-center py-3">Загрузка переписки…</p>}
                  {threadErr && <p className="text-[12px] text-red-600 text-center py-3">{threadErr}</p>}
                  {!threadLoading && !threadErr && thread.length === 0 && <p className="text-[12px] text-[#9a9a95] text-center py-3">Сообщений пока нет.</p>}
                  {thread.map(m => (
                    <div key={m.id} className={`flex ${m.from === 'us' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] whitespace-pre-wrap ${m.from === 'us' ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#111110]'}`}>
                        {m.text}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 mt-2">
                  <input value={draft} onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && draft.trim() && !sending) sendMsg() }}
                    placeholder="Написать клиенту в Авито…" disabled={sending}
                    className="flex-1 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] disabled:opacity-50" />
                  <button onClick={sendMsg} disabled={sending || !draft.trim()}
                    className="px-4 py-2 rounded-lg bg-[#0071e3] text-white text-[13px] font-medium disabled:opacity-40">
                    {sending ? '…' : 'Отправить'}
                  </button>
                </div>
              </div>
            )}

            {/* Заметка + история */}
            <div className="mt-4">
              <div className="flex gap-1.5">
                <input value={note} onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && note.trim()) { addEvent(openLead.id, 'note', note.trim()).then(() => { setNote(''); loadEvents(openLead.id) }) } }}
                  placeholder="Заметка по лиду… (Enter)" className="flex-1 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
              </div>
              <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
                {events.map(ev => (
                  <div key={ev.id} className="text-[12px] bg-[#fafaf9] rounded-lg px-3 py-1.5">
                    <p className="text-[#111110]">{ev.text}</p>
                    <p className="text-[10px] text-[#9a9a95]">{ev.author ?? ''} · {fmtD(ev.created_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
