'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient, createScopedClient } from '@/lib/supabase-browser'
import { useOrganization } from '@/lib/hooks/use-organization'
import {
  B2BClient, B2BCRM, B2BInteraction, clientToCRM,
  B2B_SEGMENTS, B2B_STATUSES, B2B_SCORES, B2B_INTERACTION_TYPES,
} from '@/lib/types'
import type { ClientAnalysis } from '@/app/api/ai/analyze-client/route'

type OutreachTemplate = {
  id: number
  segment: string
  channel: string
  stage: string
  title: string
  body: string
  cta: string | null
}

const CHANNEL_ICON: Record<string, string> = { whatsapp: '💬', email: '📧', call: '📞', telegram: '✈️' }
const STAGE_LABEL:  Record<string, string> = { cold: 'Холодный', warm: 'Тёплый', follow_up: 'Follow-up', reactivation: 'Реактивация' }

type Order = {
  id: number
  total_after_discount: number
  total_sale_inc_vat: number
  discount_percent: number
  margin_percent: number
  created_at: string
  notes: string | null
}

const CRM_COLS = 'id,name,contact,phone,discount_percent,active,notes,created_at,updated_at,crm_segment,crm_status,crm_score,crm_city,crm_manager,crm_next_contact,crm_notes'

const segmentLabel = (v: string | null) => B2B_SEGMENTS.find(s => s.value === v)?.label ?? v ?? '—'
const statusMeta   = (v: string | null) => B2B_STATUSES.find(s => s.value === v) ?? { label: '—', color: 'bg-[#f0f0ec] text-[#6b6b66]' }
const scoreMeta    = (v: string | null) => B2B_SCORES.find(s => s.value === v) ?? { label: '—', color: 'bg-[#f0f0ec] text-[#6b6b66]' }
const typeIcon     = (v: string) => B2B_INTERACTION_TYPES.find(t => t.value === v)?.icon ?? '📝'
const typeLabel    = (v: string) => B2B_INTERACTION_TYPES.find(t => t.value === v)?.label ?? v

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtDateShort(s: string) {
  return new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short' })
}
function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
}

const EMPTY_INTERACTION = { type: 'call', note: '', outcome: '', next_action: '', next_action_date: '' }

export default function B2BClientCardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { orgId } = useOrganization()
  const clientId = Number(id)

  const [client, setClient]           = useState<B2BClient | null>(null)
  const [interactions, setInteractions] = useState<B2BInteraction[]>([])
  const [orders, setOrders]           = useState<Order[]>([])
  const [templates, setTemplates]     = useState<OutreachTemplate[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [copiedId, setCopiedId]       = useState<number | null>(null)
  const [loading, setLoading]         = useState(true)

  const [newInt, setNewInt]     = useState(EMPTY_INTERACTION)
  const [savingInt, setSavingInt] = useState(false)

  const [editing, setEditing]       = useState(false)
  const [editCRM, setEditCRM]       = useState<Partial<B2BCRM & { name: string; contact: string; phone: string; discount_percent: number }>>({})
  const [savingClient, setSavingClient] = useState(false)

  const [aiAnalysis, setAiAnalysis]   = useState<ClientAnalysis | null>(null)
  const [aiLoading, setAiLoading]     = useState(false)
  const [aiError, setAiError]         = useState<string | null>(null)
  const [copiedTemplate, setCopiedTemplate] = useState(false)

  type PersonalizedPreview = { templateId: number; original: string; personalized: string }
  const [personalizingId, setPersonalizingId]   = useState<number | null>(null)
  const [personalizedPreview, setPersonalizedPreview] = useState<PersonalizedPreview | null>(null)

  const [toast, setToast]             = useState<string | null>(null)
  const [clientVersion, setClientVersion] = useState<string | null>(null)
  const savingRef = useRef(false)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000) }

  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { load().catch(() => setLoading(false)) }, [clientId])

  // Realtime — уведомление когда другой менеджер обновил запись
  useEffect(() => {
    const sb = createClient()
    const channel = sb
      .channel(`client-${clientId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'b2b_clients',
        filter: `id=eq.${clientId}`,
      }, (payload) => {
        if (savingRef.current) return  // наше собственное сохранение — игнорируем
        showToast('Данные обновлены другим менеджером — обновите страницу')
        const newUpdatedAt = (payload.new as Record<string, unknown>)?.updated_at
        if (typeof newUpdatedAt === 'string') setClientVersion(newUpdatedAt)
      })
      .subscribe()
    return () => { sb.removeChannel(channel) }
  }, [clientId])

  // Derived CRM view — always in sync with client state, no separate state needed
  const crm = useMemo(() => client ? clientToCRM(client) : null, [client])

  async function load() {
    setLoading(true)
    const sb = createClient()
    const [{ data: c }, { data: ords }, { data: ints }] = await Promise.all([
      sb.from('b2b_clients').select(CRM_COLS).eq('id', clientId).single(),
      sb.from('b2b_orders')
        .select('id,total_after_discount,total_sale_inc_vat,discount_percent,margin_percent,created_at,notes')
        .eq('client_id', clientId).order('created_at', { ascending: false }).limit(20),
      sb.from('b2b_interactions')
        .select('id,client_id,type,note,outcome,next_action,next_action_date,created_by,created_at')
        .eq('client_id', clientId).order('created_at', { ascending: false }),
    ])
    const clientData = c as B2BClient | null
    setClient(clientData ?? null)
    if (clientData?.updated_at) setClientVersion(clientData.updated_at)
    setOrders(ords ?? [])
    setInteractions((ints ?? []) as B2BInteraction[])
    if (clientData) {
      const crmData = clientToCRM(clientData)
      setEditCRM({ ...crmData, name: clientData.name, contact: clientData.contact ?? '', phone: clientData.phone ?? '', discount_percent: clientData.discount_percent })
      const tQuery = sb.from('b2b_outreach_templates').select('id,segment,channel,stage,title,body,cta').eq('active', true).order('stage')
      const { data: tmpl } = crmData.segment ? await tQuery.eq('segment', crmData.segment) : await tQuery.limit(20)
      setTemplates((tmpl ?? []) as OutreachTemplate[])
    }
    setLoading(false)
  }

  async function saveInteraction() {
    if (!newInt.note.trim() || !client) return
    setSavingInt(true)
    const { sb } = createScopedClient(orgId)

    const insertPayload: Record<string, unknown> = {
      client_id:        clientId,
      organization_id:  orgId,
      type:             newInt.type,
      note:             newInt.note.trim(),
      outcome:          newInt.outcome.trim() || null,
      next_action:      newInt.next_action.trim() || null,
      next_action_date: newInt.next_action_date || null,
      created_by:       null,
    }

    const { data: inserted } = await sb
      .from('b2b_interactions')
      .insert(insertPayload)
      .select()
      .single()

    if (inserted) {
      setInteractions(prev => [inserted as B2BInteraction, ...prev])
    }

    // Update crm_next_contact on the client if a date was set — with optimistic lock
    if (newInt.next_action_date) {
      savingRef.current = true
      let q = sb.from('b2b_clients')
        .update({ crm_next_contact: newInt.next_action_date })
        .eq('id', clientId)
      if (clientVersion) q = q.eq('updated_at', clientVersion)
      const { data: updClient } = await q.select('updated_at').maybeSingle()
      savingRef.current = false
      if (updClient) {
        setClientVersion(updClient.updated_at as string)
        setClient(prev => prev ? { ...prev, crm_next_contact: newInt.next_action_date, updated_at: updClient.updated_at as string } : prev)
      } else {
        showToast('Следующий контакт не обновлён — данные изменились. Обновите страницу.')
      }
    }

    setNewInt(EMPTY_INTERACTION)
    setSavingInt(false)
  }

  async function deleteInteraction(intId: number) {
    const { sb } = createScopedClient(orgId)
    await sb.from('b2b_interactions').delete().eq('id', intId).eq('organization_id', orgId)
    setInteractions(prev => prev.filter(i => i.id !== intId))
  }

  async function saveClient() {
    if (!client) return
    setSavingClient(true)
    savingRef.current = true
    const { sb } = createScopedClient(orgId)

    const payload = {
      name:             editCRM.name ?? client.name,
      contact:          editCRM.contact || null,
      phone:            editCRM.phone || null,
      discount_percent: Number(editCRM.discount_percent ?? 0),
      crm_segment:      editCRM.segment ?? null,
      crm_status:       editCRM.status ?? null,
      crm_score:        editCRM.score ?? null,
      crm_city:         editCRM.city ?? null,
      crm_manager:      editCRM.manager_name ?? null,
      crm_next_contact: editCRM.next_contact_date || null,
      crm_notes:        editCRM.crm_notes || null,
    }

    let query = sb.from('b2b_clients').update(payload).eq('id', clientId)
    if (clientVersion) query = query.eq('updated_at', clientVersion)

    const { data: updated, error } = await query.select('updated_at').maybeSingle()
    savingRef.current = false

    if (error || !updated) {
      showToast(clientVersion && !updated
        ? 'Данные изменились другим менеджером. Обновите страницу.'
        : 'Ошибка сохранения.')
      setSavingClient(false)
      return
    }

    setClientVersion(updated.updated_at as string)
    setClient(prev => prev ? { ...prev, ...payload, updated_at: updated.updated_at as string } : prev)
    setEditing(false)
    setSavingClient(false)
  }

  async function runAnalysis() {
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await fetch('/api/ai/analyze-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setAiAnalysis(await res.json())
    } catch (e) {
      setAiError('Не удалось получить анализ. Проверьте подключение.')
    } finally {
      setAiLoading(false)
    }
  }

  function copyTemplate(t: OutreachTemplate) {
    const text = t.cta ? `${t.body}\n\n${t.cta}` : t.body
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedId(t.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  function insertTemplate(t: OutreachTemplate) {
    const text = t.cta ? `${t.body}\n\n${t.cta}` : t.body
    setNewInt(p => ({ ...p, note: p.note ? p.note + '\n\n' + text : text }))
  }

  async function personalizeTemplate(t: OutreachTemplate) {
    setPersonalizingId(t.id)
    setPersonalizedPreview(null)
    try {
      const res = await fetch('/api/ai/personalize-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: t.id, client_id: clientId }),
      })
      if (!res.ok) throw new Error()
      const { personalized, original } = await res.json()
      setPersonalizedPreview({ templateId: t.id, original, personalized })
    } catch {
      showToast('Ошибка при персонализации шаблона')
    } finally {
      setPersonalizingId(null)
    }
  }

  const yearTotal = orders.reduce((s, o) => s + (o.discount_percent > 0 ? o.total_after_discount : o.total_sale_inc_vat), 0)

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )
  if (!client || !crm) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Клиент не найден</div>
  )

  const sm  = statusMeta(crm.status)
  const scm = scoreMeta(crm.score)

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#111110] text-white text-[12px] px-4 py-2.5 rounded-xl shadow-lg max-w-sm">
          {toast}
        </div>
      )}
      <div className="max-w-[1100px] mx-auto px-4 py-5">

        {/* Навигация */}
        <div className="flex items-center gap-2 mb-4 text-[12px] text-[#9a9a95]">
          <Link href="/b2b-crm" className="hover:text-[#111110] transition-colors">B2B CRM</Link>
          <span>/</span>
          <span className="text-[#111110] font-medium">{client.name}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">

          {/* ══ ЛЕВАЯ КОЛОНКА: карточка клиента ══ */}
          <div className="space-y-3">

            {/* Карточка */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${scm.color}`}>{scm.label}</span>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${sm.color}`}>{sm.label}</span>
                  </div>
                  <h2 className="text-[17px] font-semibold text-[#111110] mt-1.5 leading-snug">{client.name}</h2>
                  {crm.segment && (
                    <p className="text-[12px] text-[#8a8a85] mt-0.5">{segmentLabel(crm.segment)}</p>
                  )}
                </div>
                <button
                  onClick={() => { setEditing(!editing); setEditCRM({ ...crm, name: client.name, contact: client.contact ?? '', phone: client.phone ?? '', discount_percent: client.discount_percent }) }}
                  className="text-[11px] font-medium text-[#6b6b66] border border-[#e4e4e0] px-2.5 py-1 rounded-lg hover:bg-[#f8f8f7] transition-colors shrink-0">
                  {editing ? 'Отмена' : 'Изменить'}
                </button>
              </div>

              {!editing ? (
                <div className="space-y-2 text-[13px]">
                  {client.contact && (
                    <div className="flex gap-2">
                      <span className="text-[#9a9a95] w-24 shrink-0">Контакт</span>
                      <span className="text-[#111110] font-medium">{client.contact}</span>
                    </div>
                  )}
                  {client.phone && (
                    <div className="flex gap-2">
                      <span className="text-[#9a9a95] w-24 shrink-0">Телефон</span>
                      <a href={`tel:${client.phone}`} className="text-blue-600 font-mono hover:underline">{client.phone}</a>
                    </div>
                  )}
                  {crm.city && (
                    <div className="flex gap-2">
                      <span className="text-[#9a9a95] w-24 shrink-0">Город</span>
                      <span className="text-[#111110]">{crm.city}</span>
                    </div>
                  )}
                  {crm.manager_name && (
                    <div className="flex gap-2">
                      <span className="text-[#9a9a95] w-24 shrink-0">Менеджер</span>
                      <span className="text-[#111110]">{crm.manager_name}</span>
                    </div>
                  )}
                  {client.discount_percent > 0 && (
                    <div className="flex gap-2">
                      <span className="text-[#9a9a95] w-24 shrink-0">Скидка</span>
                      <span className="text-emerald-600 font-semibold">{client.discount_percent}%</span>
                    </div>
                  )}
                  {crm.next_contact_date && (
                    <div className="flex gap-2">
                      <span className="text-[#9a9a95] w-24 shrink-0">Следующий контакт</span>
                      <span className="text-[#111110]">{fmtDate(crm.next_contact_date)}</span>
                    </div>
                  )}
                  {crm.crm_notes && (
                    <div className="pt-2 border-t border-[#f0f0ec] text-[12px] text-[#6b6b66] leading-relaxed">
                      {crm.crm_notes}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {[
                    { label: 'Название',  key: 'name',             type: 'text' },
                    { label: 'Контакт',   key: 'contact',          type: 'text' },
                    { label: 'Телефон',   key: 'phone',            type: 'text' },
                    { label: 'Город',     key: 'city',             type: 'text' },
                    { label: 'Менеджер',  key: 'manager_name',     type: 'text' },
                    { label: 'Скидка %',  key: 'discount_percent', type: 'number' },
                    { label: 'Следующий контакт', key: 'next_contact_date', type: 'date' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">{f.label}</label>
                      <input type={f.type}
                        className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] text-[#111110] outline-none focus:border-[#111110]"
                        value={(editCRM as Record<string, unknown>)[f.key] as string ?? ''}
                        onChange={e => setEditCRM(prev => ({ ...prev, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Сегмент</label>
                    <select className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] text-[#111110] outline-none focus:border-[#111110]"
                      value={editCRM.segment ?? ''} onChange={e => setEditCRM(p => ({ ...p, segment: e.target.value || null }))}>
                      <option value="">—</option>
                      {B2B_SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Статус</label>
                    <select className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] text-[#111110] outline-none focus:border-[#111110]"
                      value={editCRM.status ?? ''} onChange={e => setEditCRM(p => ({ ...p, status: e.target.value || null }))}>
                      <option value="">—</option>
                      {B2B_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Класс (A/B/C)</label>
                    <div className="flex gap-1.5">
                      {B2B_SCORES.map(s => (
                        <button key={s.value} onClick={() => setEditCRM(p => ({ ...p, score: s.value }))}
                          className={`flex-1 py-1.5 rounded-lg text-[13px] font-bold transition-colors ${editCRM.score === s.value ? s.color : 'bg-[#f0f0ec] text-[#9a9a95]'}`}>
                          {s.value}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Заметка</label>
                    <textarea rows={2}
                      className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] text-[#111110] outline-none focus:border-[#111110] resize-none"
                      value={editCRM.crm_notes ?? ''} onChange={e => setEditCRM(p => ({ ...p, crm_notes: e.target.value || null }))}
                    />
                  </div>
                  <button onClick={saveClient} disabled={savingClient || !editCRM.name?.trim()}
                    className="w-full bg-[#111110] text-white text-[13px] font-semibold py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                    {savingClient ? 'Сохранение...' : 'Сохранить'}
                  </button>
                </div>
              )}
            </div>

            {/* Статистика заказов */}
            {orders.length > 0 && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Заказы в текущем году</p>
                <div className="flex gap-4 mb-3">
                  <div>
                    <p className="text-[20px] font-bold text-[#111110] font-mono leading-none">{fmt(yearTotal)}</p>
                    <p className="text-[11px] text-[#9a9a95] mt-0.5">{orders.length} просчётов</p>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {orders.map(o => {
                    const total = o.discount_percent > 0 ? o.total_after_discount : o.total_sale_inc_vat
                    return (
                      <div key={o.id} className="flex items-center gap-2 text-[12px] py-1.5 border-b border-[#f8f8f7] last:border-0 group">
                        <Link href="/b2b-quotes" className="flex-1 flex items-center gap-2 hover:text-blue-600 transition-colors min-w-0">
                          <span className="text-[#9a9a95] shrink-0">{fmtDateShort(o.created_at)}</span>
                          <span className="font-mono font-semibold text-[#111110]">{fmt(total)}</span>
                          {o.margin_percent > 0 && (
                            <span className="text-[10px] text-[#9a9a95]">{o.margin_percent}% маржа</span>
                          )}
                        </Link>
                        <Link href={`/calculator/b2b?orderId=${o.id}`}
                          className="opacity-0 group-hover:opacity-100 text-[10px] font-medium text-purple-600 hover:bg-purple-50 px-1.5 py-0.5 rounded transition-all shrink-0">
                          в калькулятор
                        </Link>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Быстрые действия */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Быстрые действия</p>
              <div className="space-y-1.5">
                <Link href={`/calculator/b2b?client=${clientId}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e4e4e0] text-[13px] text-[#111110] hover:bg-[#f8f8f7] transition-colors">
                  <span>🧮</span> Новый просчёт
                </Link>
                {client.phone && (
                  <a href={`https://wa.me/${client.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e4e4e0] text-[13px] text-[#111110] hover:bg-[#f8f8f7] transition-colors">
                    <span>💬</span> WhatsApp
                  </a>
                )}
                {client.phone && (
                  <a href={`tel:${client.phone}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e4e4e0] text-[13px] text-[#111110] hover:bg-[#f8f8f7] transition-colors">
                    <span>📞</span> Позвонить
                  </a>
                )}
              </div>
            </div>

            {/* AI-анализ клиента */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between border-b border-[#f0f0ec]">
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">AI-анализ</p>
                <button
                  onClick={runAnalysis}
                  disabled={aiLoading}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-50 transition-colors">
                  {aiLoading ? (
                    <><span className="animate-spin inline-block">⟳</span> Анализ...</>
                  ) : (
                    <><span>✨</span> {aiAnalysis ? 'Обновить' : 'Анализировать'}</>
                  )}
                </button>
              </div>

              {aiError && (
                <div className="px-4 py-3 text-[12px] text-red-600">{aiError}</div>
              )}

              {!aiAnalysis && !aiLoading && !aiError && (
                <div className="px-4 py-6 text-center text-[12px] text-[#c4c4be]">
                  Нажмите «Анализировать» чтобы получить<br />оценку риска и рекомендации по клиенту
                </div>
              )}

              {aiAnalysis && (
                <div className="divide-y divide-[#f8f8f7]">

                  {/* Risk badge */}
                  <div className="px-4 py-3 flex items-center gap-3">
                    <span className="text-[22px] leading-none">
                      {aiAnalysis.risk === 'low' ? '🟢' : aiAnalysis.risk === 'medium' ? '🟡' : '🔴'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-[#111110]">
                        {aiAnalysis.risk === 'low' ? 'Низкий риск' : aiAnalysis.risk === 'medium' ? 'Средний риск' : 'Высокий риск потери'}
                      </p>
                      <p className="text-[11px] text-[#6b6b66] mt-0.5 leading-snug">{aiAnalysis.risk_reason}</p>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Оценка</p>
                    <p className="text-[12px] text-[#111110] leading-snug">{aiAnalysis.summary}</p>
                  </div>

                  {/* Next step */}
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Следующий шаг</p>
                    <p className="text-[12px] text-[#111110] leading-snug">{aiAnalysis.next_step}</p>
                    {aiAnalysis.next_step_date && (
                      <p className="text-[11px] text-amber-600 mt-1">через {aiAnalysis.next_step_date} дн.</p>
                    )}
                  </div>

                  {/* Message template */}
                  {aiAnalysis.message_template && (
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Шаблон сообщения</p>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(aiAnalysis.message_template).catch(() => {})
                              setCopiedTemplate(true)
                              setTimeout(() => setCopiedTemplate(false), 2000)
                            }}
                            className={`text-[10px] font-medium px-2 py-0.5 rounded-lg border transition-colors ${
                              copiedTemplate
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                : 'border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f0f0ec]'
                            }`}>
                            {copiedTemplate ? '✓ Скопировано' : 'Копировать'}
                          </button>
                          {client.phone && (
                            <a
                              href={`https://wa.me/${client.phone.replace(/\D/g, '')}?text=${encodeURIComponent(aiAnalysis.message_template)}`}
                              target="_blank" rel="noreferrer"
                              className="text-[10px] font-medium px-2 py-0.5 rounded-lg border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 transition-colors">
                              WhatsApp
                            </a>
                          )}
                        </div>
                      </div>
                      <p className="text-[12px] text-[#6b6b66] leading-relaxed whitespace-pre-wrap bg-[#f8f8f7] rounded-lg p-2.5">
                        {aiAnalysis.message_template}
                      </p>
                    </div>
                  )}

                </div>
              )}
            </div>

          </div>

          {/* ══ ПРАВАЯ КОЛОНКА: история ══ */}
          <div className="space-y-3">

            {/* Форма нового взаимодействия */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-5">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Добавить взаимодействие</p>

              <div className="flex gap-1.5 flex-wrap mb-3">
                {B2B_INTERACTION_TYPES.map(t => (
                  <button key={t.value} onClick={() => setNewInt(p => ({ ...p, type: t.value }))}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${newInt.type === t.value ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
                    <span>{typeIcon(t.value)}</span> {t.label}
                  </button>
                ))}
              </div>

              <textarea rows={2} placeholder="Что произошло? О чём говорили?"
                className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110] resize-none mb-2"
                value={newInt.note} onChange={e => setNewInt(p => ({ ...p, note: e.target.value }))}
              />

              <div className="grid grid-cols-2 gap-2 mb-3">
                <input type="text" placeholder="Итог / результат"
                  className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110]"
                  value={newInt.outcome} onChange={e => setNewInt(p => ({ ...p, outcome: e.target.value }))}
                />
                <input type="text" placeholder="Следующий шаг"
                  className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110]"
                  value={newInt.next_action} onChange={e => setNewInt(p => ({ ...p, next_action: e.target.value }))}
                />
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-[#9a9a95]">Следующий контакт:</label>
                  <input type="date"
                    className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110]"
                    value={newInt.next_action_date} onChange={e => setNewInt(p => ({ ...p, next_action_date: e.target.value }))}
                  />
                </div>
                <button onClick={saveInteraction} disabled={savingInt || !newInt.note.trim()}
                  className="ml-auto bg-[#111110] text-white text-[13px] font-semibold px-4 py-1.5 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                  {savingInt ? 'Сохранение...' : 'Добавить'}
                </button>
              </div>
            </div>

            {/* Шаблоны сообщений */}
            {templates.length > 0 && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                <button
                  onClick={() => setShowTemplates(v => !v)}
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#fafaf9] transition-colors">
                  <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">
                    Шаблоны сообщений — {templates.length}
                  </span>
                  <svg className={`w-3.5 h-3.5 text-[#9a9a95] transition-transform duration-150 ${showTemplates ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showTemplates && (
                  <div className="border-t border-[#f0f0ec] divide-y divide-[#f8f8f7]">
                    {templates.map(t => (
                      <div key={t.id} className="px-5 py-4 hover:bg-[#fafaf9] transition-colors group">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px]">{CHANNEL_ICON[t.channel] ?? '📄'}</span>
                            <span className="text-[12px] font-semibold text-[#111110]">{t.title}</span>
                            <span className="text-[10px] font-medium bg-[#f0f0ec] text-[#6b6b66] px-1.5 py-0.5 rounded">
                              {STAGE_LABEL[t.stage] ?? t.stage}
                            </span>
                          </div>
                          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                              onClick={() => personalizeTemplate(t)}
                              disabled={personalizingId === t.id}
                              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 transition-colors">
                              {personalizingId === t.id ? (
                                <span className="animate-spin inline-block text-[10px]">⟳</span>
                              ) : '✨'} Персонализировать
                            </button>
                            <button onClick={() => insertTemplate(t)}
                              className="text-[10px] font-medium px-2 py-1 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors">
                              В заметку
                            </button>
                            <button onClick={() => copyTemplate(t)}
                              className={`text-[10px] font-medium px-2 py-1 rounded-lg border transition-colors ${copiedId === t.id ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f0f0ec]'}`}>
                              {copiedId === t.id ? '✓ Скопировано' : 'Копировать'}
                            </button>
                          </div>
                        </div>
                        <p className="text-[12px] text-[#6b6b66] leading-relaxed whitespace-pre-wrap">{t.body}</p>
                        {t.cta && <p className="text-[12px] text-blue-600 mt-1 font-medium">{t.cta}</p>}

                        {/* Персонализированный preview */}
                        {personalizedPreview?.templateId === t.id && (
                          <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 overflow-hidden">
                            <div className="px-3 py-2 border-b border-purple-200 flex items-center justify-between">
                              <span className="text-[10px] font-semibold text-purple-700 uppercase tracking-widest">✨ Персонализированная версия</span>
                              <button onClick={() => setPersonalizedPreview(null)} className="text-[#9a9a95] hover:text-red-400 transition-colors text-lg leading-none">×</button>
                            </div>
                            <div className="p-3">
                              <p className="text-[12px] text-[#111110] leading-relaxed whitespace-pre-wrap">{personalizedPreview.personalized}</p>
                            </div>
                            <div className="px-3 py-2 border-t border-purple-200 flex gap-2">
                              <button
                                onClick={() => {
                                  setNewInt(p => ({ ...p, note: p.note ? p.note + '\n\n' + personalizedPreview.personalized : personalizedPreview.personalized }))
                                  setPersonalizedPreview(null)
                                }}
                                className="text-[11px] font-semibold bg-[#111110] text-white px-3 py-1 rounded-lg hover:bg-[#2a2a28] transition-colors">
                                В заметку
                              </button>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(personalizedPreview.personalized).catch(() => {})
                                  showToast('Скопировано в буфер обмена')
                                  setPersonalizedPreview(null)
                                }}
                                className="text-[11px] font-medium border border-purple-300 text-purple-700 px-3 py-1 rounded-lg hover:bg-purple-100 transition-colors">
                                Копировать
                              </button>
                              {client?.phone && (
                                <a
                                  href={`https://wa.me/${client.phone.replace(/\D/g, '')}?text=${encodeURIComponent(personalizedPreview.personalized)}`}
                                  target="_blank" rel="noreferrer"
                                  className="text-[11px] font-medium border border-green-200 text-green-700 bg-green-50 px-3 py-1 rounded-lg hover:bg-green-100 transition-colors">
                                  WhatsApp
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Лента истории */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#f0f0ec]">
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">
                  История взаимодействий {interactions.length > 0 && `— ${interactions.length}`}
                </span>
              </div>

              {interactions.length === 0 ? (
                <div className="py-12 text-center text-[13px] text-[#c4c4be]">
                  Нет записей — добавьте первое взаимодействие
                </div>
              ) : (
                <div className="divide-y divide-[#f8f8f7]">
                  {interactions.map(i => (
                    <div key={i.id} className="px-5 py-4 hover:bg-[#fafaf9] transition-colors group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <span className="text-[16px] mt-0.5 shrink-0">{typeIcon(i.type)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[11px] font-semibold text-[#9a9a95]">{typeLabel(i.type)}</span>
                              <span className="text-[11px] text-[#c4c4be]">
                                {fmtDate(i.created_at)} · {fmtTime(i.created_at)}
                              </span>
                              {i.created_by && (
                                <span className="text-[11px] text-[#c4c4be]">{i.created_by}</span>
                              )}
                            </div>
                            <p className="text-[13px] text-[#111110] leading-snug">{i.note}</p>
                            {i.outcome && (
                              <p className="text-[12px] text-emerald-700 mt-1">
                                <span className="font-medium">Итог:</span> {i.outcome}
                              </p>
                            )}
                            {i.next_action && (
                              <p className="text-[12px] text-blue-600 mt-0.5">
                                <span className="font-medium">Следующий шаг:</span> {i.next_action}
                                {i.next_action_date && ` · ${fmtDate(i.next_action_date)}`}
                              </p>
                            )}
                          </div>
                        </div>
                        <button onClick={() => deleteInteraction(i.id)}
                          className="opacity-0 group-hover:opacity-100 text-[#c4c4be] hover:text-red-400 transition-all text-lg leading-none shrink-0">
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
