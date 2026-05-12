'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createScopedClient } from '@/lib/supabase-browser'
import { useOrganization } from '@/lib/hooks/use-organization'
import {
  B2BClient, B2BCRM, B2BInteraction, clientToCRM,
  B2B_SEGMENTS, B2B_STATUSES, B2B_SCORES,
} from '@/lib/types'
import Pagination from '@/components/Pagination'

const PAGE_SIZE = 50

type ClientWithMeta = B2BClient & {
  crm: B2BCRM
  lastInteraction: B2BInteraction | null
  yearTotal: number
  orderCount: number
}

const CRM_COLS = 'id,name,contact,phone,discount_percent,active,notes,created_at,crm_segment,crm_status,crm_score,crm_city,crm_manager,crm_next_contact,crm_notes'

const segmentLabel = (v: string | null) =>
  B2B_SEGMENTS.find(s => s.value === v)?.label ?? v ?? '—'

const statusMeta = (v: string | null) =>
  B2B_STATUSES.find(s => s.value === v) ?? { label: '—', color: 'bg-[#f0f0ec] text-[#6b6b66]' }

const scoreMeta = (v: string | null) =>
  B2B_SCORES.find(s => s.value === v) ?? { label: '—', color: 'bg-[#f0f0ec] text-[#6b6b66]' }

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0)
  return Math.ceil(diff / 86_400_000)
}

function nextContactLabel(dateStr: string | null) {
  const d = daysUntil(dateStr)
  if (d === null) return null
  if (d < 0) return { text: `просрочено ${-d}д`, cls: 'text-red-600 font-semibold' }
  if (d === 0) return { text: 'сегодня', cls: 'text-orange-600 font-semibold' }
  if (d <= 3) return { text: `через ${d}д`, cls: 'text-amber-600 font-medium' }
  return { text: `через ${d}д`, cls: 'text-[#8a8a85]' }
}

const SCORE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 }
const STATUS_ORDER: Record<string, number> = { active: 0, contacted: 1, new: 2, sleeping: 3, lost: 4 }

type ExpandMode = 'note' | 'remind'

const INTERACTION_TYPES = [
  { value: 'call',    label: 'Звонок'   },
  { value: 'email',   label: 'E-mail'   },
  { value: 'meeting', label: 'Встреча'  },
  { value: 'message', label: 'Сообщение'},
]

export default function B2BCRMPage() {
  const router = useRouter()
  const { orgId } = useOrganization()
  const [clients, setClients] = useState<ClientWithMeta[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [filterSegment, setFilterSegment] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterScore, setFilterScore] = useState('')
  const [filterOverdue, setFilterOverdue] = useState(false)
  const [page, setPage] = useState(1)

  // Inline actions
  const [expandedId,   setExpandedId]   = useState<number | null>(null)
  const [expandMode,   setExpandMode]   = useState<ExpandMode>('note')
  const [quickNote,    setQuickNote]    = useState('')
  const [quickType,    setQuickType]    = useState('call')
  const [remindDate,   setRemindDate]   = useState('')
  const [savingInline, setSavingInline] = useState(false)
  const [inlineToast,  setInlineToast]  = useState<string | null>(null)

  useEffect(() => { load() }, [orgId])

  async function load() {
    setLoading(true)
    // fromOrg() automatically appends .eq('organization_id', orgId)
    // RLS on the DB enforces the same constraint as a second layer of defense.
    const { fromOrg } = createScopedClient(orgId)
    const year = new Date().getFullYear()

    const [{ data: cls }, { data: orders }, { data: lastInts }] = await Promise.all([
      fromOrg('b2b_clients', CRM_COLS).order('name'),
      fromOrg('b2b_orders', 'client_id,total_after_discount')
        .gte('created_at', `${year}-01-01`),
      fromOrg('b2b_interactions', 'id,client_id,type,note,outcome,next_action,next_action_date,created_by,created_at')
        .order('created_at', { ascending: false })
        .limit(2000),
    ])

    const totalByClient = new Map<number, number>()
    const countByClient = new Map<number, number>()
    for (const o of orders ?? []) {
      totalByClient.set(o.client_id, (totalByClient.get(o.client_id) ?? 0) + o.total_after_discount)
      countByClient.set(o.client_id, (countByClient.get(o.client_id) ?? 0) + 1)
    }

    // Pick the most recent interaction per client (already ordered DESC)
    const lastIntByClient = new Map<number, B2BInteraction>()
    for (const i of (lastInts ?? []) as B2BInteraction[]) {
      if (!lastIntByClient.has(i.client_id)) lastIntByClient.set(i.client_id, i)
    }

    const enriched: ClientWithMeta[] = (cls ?? []).map((c: B2BClient) => ({
      ...c,
      crm: clientToCRM(c),
      lastInteraction: lastIntByClient.get(c.id) ?? null,
      yearTotal: totalByClient.get(c.id) ?? 0,
      orderCount: countByClient.get(c.id) ?? 0,
    }))

    setClients(enriched)
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let list = clients.filter(c => c.active)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.contact ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').includes(q)
      )
    }
    if (filterSegment) list = list.filter(c => c.crm.segment === filterSegment)
    if (filterStatus)  list = list.filter(c => c.crm.status === filterStatus)
    if (filterScore)   list = list.filter(c => c.crm.score === filterScore)
    if (filterOverdue) list = list.filter(c => {
      const d = daysUntil(c.crm.next_contact_date)
      return d !== null && d <= 0
    })

    setPage(1)
    return list.sort((a, b) => {
      const dA = daysUntil(a.crm.next_contact_date)
      const dB = daysUntil(b.crm.next_contact_date)
      const overdueA = dA !== null && dA <= 0 ? 1 : 0
      const overdueB = dB !== null && dB <= 0 ? 1 : 0
      if (overdueA !== overdueB) return overdueB - overdueA
      const sa = SCORE_ORDER[a.crm.score ?? 'C'] ?? 2
      const sb2 = SCORE_ORDER[b.crm.score ?? 'C'] ?? 2
      if (sa !== sb2) return sa - sb2
      const sta = STATUS_ORDER[a.crm.status ?? 'new'] ?? 2
      const stb = STATUS_ORDER[b.crm.status ?? 'new'] ?? 2
      return sta - stb
    })
  }, [clients, search, filterSegment, filterStatus, filterScore, filterOverdue])

  const overdueCount = useMemo(() =>
    clients.filter(c => c.active && (daysUntil(c.crm.next_contact_date) ?? 1) <= 0).length,
    [clients]
  )

  function toggleInline(clientId: number, mode: ExpandMode) {
    if (expandedId === clientId && expandMode === mode) {
      setExpandedId(null)
    } else {
      setExpandedId(clientId)
      setExpandMode(mode)
      setQuickNote('')
      setQuickType('call')
      setRemindDate('')
    }
  }

  function showInlineToast(msg: string) {
    setInlineToast(msg)
    setTimeout(() => setInlineToast(null), 2000)
  }

  async function saveQuickLog(clientId: number) {
    if (!quickNote.trim()) return
    setSavingInline(true)
    const { insertOrg, sb } = createScopedClient(orgId)
    const [intResult, clientResult] = await Promise.all([
      insertOrg('b2b_interactions', {
        client_id: clientId, type: quickType, note: quickNote.trim(),
      }),
      sb.from('b2b_clients').update({ crm_status: 'contacted' }).eq('id', clientId).eq('organization_id', orgId),
    ])
    setSavingInline(false)
    if (intResult.error || clientResult.error) { showInlineToast('Ошибка при сохранении'); return }
    showInlineToast('Лог сохранён')
    setExpandedId(null)
    load()
  }

  async function saveRemind(clientId: number) {
    if (!remindDate) return
    setSavingInline(true)
    const { sb } = createScopedClient(orgId)
    const { error } = await sb.from('b2b_clients').update({ crm_next_contact: remindDate }).eq('id', clientId).eq('organization_id', orgId)
    setSavingInline(false)
    if (error) { showInlineToast('Ошибка при сохранении'); return }
    showInlineToast('Напоминание установлено')
    setExpandedId(null)
    load()
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      {inlineToast && (
        <div className="fixed top-4 right-4 z-50 bg-[#111110] text-white text-[12px] px-4 py-2.5 rounded-xl shadow-lg pointer-events-none">
          {inlineToast}
        </div>
      )}
      <div className="max-w-[1200px] mx-auto px-4 py-5">

        {/* Шапка */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[16px] font-semibold text-[#111110] tracking-tight">B2B CRM</h1>
            <p className="text-[12px] text-[#8a8a85] mt-0.5">
              {clients.filter(c => c.active).length} активных клиентов
              {overdueCount > 0 && (
                <span className="ml-2 text-red-600 font-semibold">· {overdueCount} просроченных</span>
              )}
            </p>
          </div>
          <button
            onClick={() => router.push('/admin/b2b-clients')}
            className="text-[12px] text-[#6b6b66] border border-[#e4e4e0] px-3 py-1.5 rounded-lg hover:bg-white transition-colors">
            + Добавить клиента
          </button>
        </div>

        {/* Фильтры */}
        <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 mb-4 flex flex-wrap gap-2 items-center">
          <input
            type="text" placeholder="Поиск по имени, телефону..."
            className="flex-1 min-w-[180px] bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110] transition-all"
            value={search} onChange={e => setSearch(e.target.value)}
          />
          <select
            className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#6b6b66] outline-none focus:border-[#111110]"
            value={filterSegment} onChange={e => setFilterSegment(e.target.value)}>
            <option value="">Все сегменты</option>
            {B2B_SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select
            className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#6b6b66] outline-none focus:border-[#111110]"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Все статусы</option>
            {B2B_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select
            className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#6b6b66] outline-none focus:border-[#111110]"
            value={filterScore} onChange={e => setFilterScore(e.target.value)}>
            <option value="">Все классы</option>
            {B2B_SCORES.map(s => <option key={s.value} value={s.value}>Класс {s.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={filterOverdue} onChange={e => setFilterOverdue(e.target.checked)}
              className="w-3.5 h-3.5 accent-red-500" />
            <span className="text-[12px] text-red-600 font-medium">Просроченные</span>
          </label>
          {(search || filterSegment || filterStatus || filterScore || filterOverdue) && (
            <button
              onClick={() => { setSearch(''); setFilterSegment(''); setFilterStatus(''); setFilterScore(''); setFilterOverdue(false) }}
              className="text-[11px] text-[#9a9a95] hover:text-red-500 transition-colors">
              Сбросить
            </button>
          )}
        </div>

        {/* Список */}
        {loading ? (
          <div className="py-16 text-center text-[13px] text-[#8a8a85]">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-[#8a8a85]">Нет клиентов по фильтру</div>
        ) : (
          <>
            <Pagination
              page={page} total={filtered.length} pageSize={PAGE_SIZE}
              onPageChange={setPage} className="mb-3"
            />
          <div className="space-y-2">
            {filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(c => {
              const nc  = nextContactLabel(c.crm.next_contact_date)
              const sm  = statusMeta(c.crm.status)
              const scm = scoreMeta(c.crm.score)
              const isExpanded = expandedId === c.id
              return (
                <div key={c.id} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden hover:border-[#c4c4be] hover:shadow-sm transition-all">

                  {/* Основная строка — кликабельна для перехода */}
                  <div
                    onClick={() => router.push(`/b2b-crm/${c.id}`)}
                    className="px-5 py-4 cursor-pointer">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[14px] font-semibold text-[#111110] truncate">{c.name}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${scm.color}`}>{scm.label}</span>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${sm.color}`}>{sm.label}</span>
                          {c.crm.segment && (
                            <span className="text-[10px] text-[#9a9a95] bg-[#f0f0ec] px-2 py-0.5 rounded-full">
                              {segmentLabel(c.crm.segment)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {c.contact && <span className="text-[12px] text-[#6b6b66]">{c.contact}</span>}
                          {c.phone && <span className="text-[12px] text-[#9a9a95] font-mono">{c.phone}</span>}
                          {c.crm.manager_name && (
                            <span className="text-[11px] text-[#9a9a95]">менеджер: {c.crm.manager_name}</span>
                          )}
                        </div>
                        {c.lastInteraction && (
                          <div className="mt-1.5 text-[11px] text-[#9a9a95] truncate">
                            <span className="text-[#c4c4be]">
                              {new Date(c.lastInteraction.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                            </span>
                            {' · '}
                            {c.lastInteraction.note}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {c.yearTotal > 0 && (
                          <span className="text-[13px] font-semibold font-mono text-[#111110]">
                            {c.yearTotal.toLocaleString('ru-RU')} ₽
                          </span>
                        )}
                        {c.orderCount > 0 && (
                          <span className="text-[11px] text-[#9a9a95]">{c.orderCount} заказов</span>
                        )}
                        {nc && <span className={`text-[11px] ${nc.cls}`}>{nc.text}</span>}
                        {c.discount_percent > 0 && (
                          <span className="text-[11px] text-emerald-600 font-medium">скидка {c.discount_percent}%</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Панель быстрых действий */}
                  <div
                    onClick={e => e.stopPropagation()}
                    className="border-t border-[#f0f0ec] px-4 py-2 flex items-center gap-2 bg-[#fafaf9]">
                    <button
                      onClick={() => toggleInline(c.id, 'note')}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors ${isExpanded && expandMode === 'note' ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f0f0ec]'}`}>
                      + Лог
                    </button>
                    <button
                      onClick={() => toggleInline(c.id, 'remind')}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors ${isExpanded && expandMode === 'remind' ? 'bg-[#111110] text-white' : 'text-[#6b6b66] hover:bg-[#f0f0ec]'}`}>
                      Напомнить
                    </button>
                    <a
                      href={`/calculator/b2b?clientId=${c.id}`}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors">
                      КП →
                    </a>
                  </div>

                  {/* Инлайн-форма — на мобильных отображается как bottom sheet */}
                  {isExpanded && (
                    <div
                      onClick={e => e.stopPropagation()}
                      className="border-t border-[#f0f0ec] px-4 py-3 bg-white slide-up">
                      {expandMode === 'note' && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            value={quickType}
                            onChange={e => setQuickType(e.target.value)}
                            className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#6b6b66] outline-none focus:border-[#111110] bg-[#fafaf9]">
                            {INTERACTION_TYPES.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            autoFocus
                            placeholder="Краткая запись..."
                            value={quickNote}
                            onChange={e => setQuickNote(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && saveQuickLog(c.id)}
                            className="flex-1 min-w-[200px] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110] bg-[#fafaf9]"
                          />
                          <button
                            onClick={() => saveQuickLog(c.id)}
                            disabled={savingInline || !quickNote.trim()}
                            className="text-[12px] font-semibold bg-[#111110] text-white px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-[#2a2a28] transition-colors">
                            {savingInline ? '...' : 'Сохранить'}
                          </button>
                        </div>
                      )}
                      {expandMode === 'remind' && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] text-[#6b6b66]">Следующий контакт:</span>
                          <input
                            type="date"
                            autoFocus
                            value={remindDate}
                            onChange={e => setRemindDate(e.target.value)}
                            className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110] bg-[#fafaf9]"
                          />
                          <button
                            onClick={() => saveRemind(c.id)}
                            disabled={savingInline || !remindDate}
                            className="text-[12px] font-semibold bg-[#111110] text-white px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-[#2a2a28] transition-colors">
                            {savingInline ? '...' : 'Сохранить'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
            <Pagination
              page={page} total={filtered.length} pageSize={PAGE_SIZE}
              onPageChange={setPage} className="mt-4"
            />
          </>
        )}
      </div>
    </div>
  )
}
