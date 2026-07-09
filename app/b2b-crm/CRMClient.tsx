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
  yearTotal: number    // сумма заказов 2025+2026 — по ней сортировка «крупные сверху»
  orderCount: number   // заказов всего (2025+2026)
  count25: number
  count26: number
}

const CRM_COLS = 'id,name,contact,phone,discount_percent,active,notes,created_at,crm_segment,crm_status,crm_score,crm_city,crm_manager,crm_next_contact,crm_notes,manager_id,manager_code,full_name,inn,kpp,ogrn,legal_address,bank_account,bank_name,bik,corr_account'

// Поля карточки реквизитов; «карточка заполнена» = есть ИНН
const REQ_FIELDS = [
  { key: 'full_name',     label: 'Полное юр. наименование', wide: true },
  { key: 'inn',           label: 'ИНН' },
  { key: 'kpp',           label: 'КПП' },
  { key: 'ogrn',          label: 'ОГРН / ОГРНИП' },
  { key: 'legal_address', label: 'Юридический адрес', wide: true },
  { key: 'bank_account',  label: 'Р/С' },
  { key: 'bank_name',     label: 'Банк' },
  { key: 'bik',           label: 'БИК' },
  { key: 'corr_account',  label: 'К/С' },
] as const
type ReqKey = typeof REQ_FIELDS[number]['key']
type ReqForm = Record<ReqKey, string>
const emptyReqForm = (): ReqForm => Object.fromEntries(REQ_FIELDS.map(f => [f.key, ''])) as ReqForm
const hasRequisites = (c: B2BClient) => !!(c.inn && String(c.inn).trim())

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

type ExpandMode = 'note' | 'remind' | 'manager' | 'requisites'

type ManagerOption = { id: string; name: string; code: number | null }

const INTERACTION_TYPES = [
  { value: 'call',    label: 'Звонок'   },
  { value: 'email',   label: 'E-mail'   },
  { value: 'meeting', label: 'Встреча'  },
  { value: 'message', label: 'Сообщение'},
]

export default function B2BCRMClient() {
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
  const [managers, setManagers]         = useState<ManagerOption[]>([])
  const [assigningManagerId, setAssigningManagerId] = useState<string>('')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Реквизиты: инлайн-форма + AI-разбор вставленной карточки организации
  const [reqForm, setReqForm] = useState<ReqForm>(emptyReqForm())
  const [reqPaste, setReqPaste] = useState('')
  const [reqParsing, setReqParsing] = useState(false)

  useEffect(() => { load(); loadManagers() }, [orgId])

  async function load() {
    setLoading(true)
    // fromOrg() automatically appends .eq('organization_id', orgId)
    // RLS on the DB enforces the same constraint as a second layer of defense.
    const { fromOrg } = createScopedClient(orgId)

    const [{ data: cls }, { data: orders }, { data: lastInts }] = await Promise.all([
      fromOrg('b2b_clients', CRM_COLS).order('name'),
      // 2025 + 2026: сортировка по общему обороту и счётчики дашборда по годам
      fromOrg('b2b_orders', 'client_id,total_after_discount,created_at')
        .gte('created_at', '2025-01-01')
        .limit(10000),
      fromOrg('b2b_interactions', 'id,client_id,type,note,outcome,next_action,next_action_date,created_by,created_at')
        .order('created_at', { ascending: false })
        .limit(2000),
    ])

    const totalByClient = new Map<number, number>()
    const countByClient = new Map<number, number>()
    const count25ByClient = new Map<number, number>()
    const count26ByClient = new Map<number, number>()
    for (const o of orders ?? []) {
      totalByClient.set(o.client_id, (totalByClient.get(o.client_id) ?? 0) + (o.total_after_discount ?? 0))
      countByClient.set(o.client_id, (countByClient.get(o.client_id) ?? 0) + 1)
      const y = String(o.created_at ?? '').slice(0, 4)
      if (y === '2025') count25ByClient.set(o.client_id, (count25ByClient.get(o.client_id) ?? 0) + 1)
      if (y === '2026') count26ByClient.set(o.client_id, (count26ByClient.get(o.client_id) ?? 0) + 1)
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
      count25: count25ByClient.get(c.id) ?? 0,
      count26: count26ByClient.get(c.id) ?? 0,
    }))

    setClients(enriched)
    setLoading(false)
  }

  async function loadManagers() {
    const { sb } = createScopedClient(orgId)
    const { data: session } = await sb.auth.getUser()
    if (session?.user) setCurrentUserId(session.user.id)
    const { data } = await sb.from('users').select('id,name,email,manager_code').eq('role', 'manager')
    if (data) setManagers(data.map(u => ({ id: u.id, name: u.name ?? u.email, code: u.manager_code ?? null })))
  }

  async function assignManager(client: ClientWithMeta, newManagerId: string) {
    const newManager = managers.find(m => m.id === newManagerId) ?? null
    const { sb } = createScopedClient(orgId)

    const { data: me } = await sb.auth.getUser()
    const myId = me?.user?.id ?? null
    const { data: myProfile } = myId
      ? await sb.from('users').select('name,email').eq('id', myId).single()
      : { data: null }
    const myName = myProfile ? (myProfile.name ?? myProfile.email ?? 'Администратор') : 'Администратор'

    // Save history
    await sb.from('b2b_client_manager_history').insert({
      client_id: client.id,
      old_manager_id: client.manager_id ?? null,
      old_manager_name: client.crm.manager_name ?? null,
      new_manager_id: newManagerId || null,
      new_manager_name: newManager?.name ?? null,
      changed_by: myId,
      changed_by_name: myName,
    })

    // Update client
    await sb.from('b2b_clients').update({
      manager_id: newManagerId || null,
      manager_code: newManager?.code ?? null,
      crm_manager: newManager?.name ?? null,
    }).eq('id', client.id)

    showInlineToast(newManager ? `Назначен: ${newManager.name}` : 'Менеджер снят')
    setExpandedId(null)
    load()
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
    // Крупные клиенты сверху: оборот 2025+2026 → число заказов → имя
    return list.sort((a, b) => {
      if (b.yearTotal !== a.yearTotal) return b.yearTotal - a.yearTotal
      if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount
      return a.name.localeCompare(b.name, 'ru')
    })
  }, [clients, search, filterSegment, filterStatus, filterScore, filterOverdue])

  // Панель приборов: активные, заказы по годам, топ-3 по числу заказов
  const dash = useMemo(() => {
    const act = clients.filter(c => c.active)
    const orders25 = act.reduce((s, c) => s + c.count25, 0)
    const orders26 = act.reduce((s, c) => s + c.count26, 0)
    const volume   = act.reduce((s, c) => s + c.yearTotal, 0)
    const withReq  = act.filter(c => hasRequisites(c)).length
    const top3 = [...act].filter(c => c.orderCount > 0)
      .sort((a, b) => b.orderCount - a.orderCount || b.yearTotal - a.yearTotal)
      .slice(0, 3)
    return { activeCount: act.length, orders25, orders26, volume, withReq, top3 }
  }, [clients])

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

  function openRequisites(c: ClientWithMeta) {
    setReqForm(Object.fromEntries(REQ_FIELDS.map(f => [f.key, (c[f.key] ?? '') as string])) as ReqForm)
    setReqPaste('')
    toggleInline(c.id, 'requisites')
  }

  async function parseRequisites() {
    if (!reqPaste.trim()) return
    setReqParsing(true)
    try {
      const r = await fetch('/api/ai/parse-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: reqPaste }),
      })
      const j = await r.json()
      const cu = j.customer ?? {}
      setReqForm(prev => ({
        ...prev,
        full_name:     cu.name ?? prev.full_name,
        inn:           cu.inn ?? prev.inn,
        kpp:           cu.kpp ?? prev.kpp,
        ogrn:          cu.ogrn ?? prev.ogrn,
        legal_address: cu.legal_address ?? prev.legal_address,
        bank_account:  cu.account ?? prev.bank_account,
        bank_name:     cu.bank ?? prev.bank_name,
        bik:           cu.bik ?? prev.bik,
        corr_account:  cu.corr_account ?? prev.corr_account,
      }))
      showInlineToast('Карточка разобрана — проверьте поля')
    } catch {
      showInlineToast('Не удалось разобрать текст')
    } finally { setReqParsing(false) }
  }

  async function saveRequisites(clientId: number) {
    setSavingInline(true)
    const { sb } = createScopedClient(orgId)
    const patch = Object.fromEntries(REQ_FIELDS.map(f => [f.key, reqForm[f.key].trim() || null]))
    const { error } = await sb.from('b2b_clients').update(patch).eq('id', clientId).eq('organization_id', orgId)
    setSavingInline(false)
    if (error) { showInlineToast('Ошибка при сохранении'); return }
    showInlineToast('Реквизиты сохранены')
    setExpandedId(null)
    load()
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

        {/* Панель приборов */}
        {!loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Активных клиентов</p>
              <p className="text-[22px] font-bold text-[#111110] mt-0.5">{dash.activeCount}</p>
              <p className="text-[11px] text-[#9a9a95]">реквизиты: <span className={dash.withReq === dash.activeCount ? 'text-emerald-600 font-semibold' : 'text-[#6b6b66]'}>{dash.withReq}/{dash.activeCount}</span></p>
            </div>
            <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Заказы 2025</p>
              <p className="text-[22px] font-bold text-[#111110] mt-0.5">{dash.orders25}</p>
            </div>
            <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Заказы 2026</p>
              <p className="text-[22px] font-bold text-[#111110] mt-0.5">{dash.orders26}</p>
              <p className="text-[11px] text-[#9a9a95]">оборот {Math.round(dash.volume).toLocaleString('ru-RU')} ₽</p>
            </div>
            <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95]">Топ по заказам</p>
              {dash.top3.length === 0 ? <p className="text-[13px] text-[#9a9a95] mt-1">—</p> : (
                <div className="mt-1 space-y-0.5">
                  {dash.top3.map((c, i) => (
                    <p key={c.id} className="text-[11px] text-[#111110] truncate">
                      <span className="font-bold">{['🥇','🥈','🥉'][i]}</span> {c.name}
                      <span className="text-[#9a9a95]"> · {c.orderCount} зак. · {Math.round(c.yearTotal).toLocaleString('ru-RU')} ₽</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

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
                    <button
                      onClick={() => { toggleInline(c.id, 'manager'); setAssigningManagerId(c.manager_id ?? '') }}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors ${isExpanded && expandMode === 'manager' ? 'bg-orange-500 text-white' : 'text-orange-600 hover:bg-orange-50'}`}>
                      Менеджер
                    </button>
                    <button
                      onClick={() => openRequisites(c)}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                        isExpanded && expandMode === 'requisites'
                          ? 'bg-[#111110] text-white border-[#111110]'
                          : hasRequisites(c)
                            ? 'text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
                            : 'text-red-600 border-red-300 bg-red-50 hover:bg-red-100'
                      }`}>
                      {hasRequisites(c) ? '✓ Реквизиты' : '! Реквизиты'}
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
                      {expandMode === 'requisites' && (
                        <div className="space-y-3">
                          {/* AI-разбор карточки организации */}
                          <div className="flex items-start gap-2">
                            <textarea
                              value={reqPaste}
                              onChange={e => setReqPaste(e.target.value)}
                              placeholder="Вставьте текст карточки организации (реквизиты из письма/файла) — разберу автоматически…"
                              rows={2}
                              className="flex-1 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#111110] bg-[#fafaf9] resize-y"
                            />
                            <button
                              onClick={parseRequisites}
                              disabled={reqParsing || !reqPaste.trim()}
                              className="text-[12px] font-medium px-3 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 transition-colors whitespace-nowrap">
                              {reqParsing ? 'Разбираю…' : '🪄 Разобрать'}
                            </button>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            {REQ_FIELDS.map(f => (
                              <div key={f.key} className={'wide' in f && f.wide ? 'md:col-span-3' : ''}>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1">{f.label}</p>
                                <input
                                  value={reqForm[f.key]}
                                  onChange={e => setReqForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                                  className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#111110] bg-[#fafaf9]"
                                />
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => saveRequisites(c.id)}
                              disabled={savingInline}
                              className="text-[12px] font-semibold bg-[#111110] text-white px-4 py-1.5 rounded-lg disabled:opacity-40 hover:bg-[#2a2a28] transition-colors">
                              {savingInline ? '...' : 'Сохранить реквизиты'}
                            </button>
                            <span className="text-[11px] text-[#9a9a95]">заполненная карточка подставляется в счета автоматически</span>
                          </div>
                        </div>
                      )}
                      {expandMode === 'manager' && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] text-[#6b6b66]">Ответственный менеджер:</span>
                          <select
                            autoFocus
                            value={assigningManagerId}
                            onChange={e => setAssigningManagerId(e.target.value)}
                            className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110] bg-[#fafaf9]">
                            <option value="">— Без менеджера —</option>
                            {managers.map(m => (
                              <option key={m.id} value={m.id}>
                                {m.name}{m.code ? ` (${m.code})` : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => assignManager(c, assigningManagerId)}
                            disabled={savingInline}
                            className="text-[12px] font-semibold bg-orange-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-orange-600 transition-colors">
                            {savingInline ? '...' : 'Назначить'}
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
