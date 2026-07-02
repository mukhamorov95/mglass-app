'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { B2BClient, B2BCRM, B2BInteraction, clientToCRM, B2B_INTERACTION_TYPES } from '@/lib/types'

type Quote = {
  id: number
  client_id: number
  client_name: string
  total_after_discount: number
  total_sale_inc_vat: number
  discount_percent: number
  margin_percent: number
  notes: string | null
  created_at: string
  created_by: string | null
}

type ClientWithMeta = B2BClient & {
  crm: B2BCRM
  lastInteraction: B2BInteraction | null
  yearTotal: number
}

function parseNotes(n: string | null): Record<string, unknown> {
  if (!n) return {}
  try { const p = JSON.parse(n); if (typeof p === 'object') return p } catch {}
  return {}
}
function daysAgo(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
}
function daysUntil(dateStr: string | null) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
}
function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }
const typeIcon = (v: string) => B2B_INTERACTION_TYPES.find(t => t.value === v)?.icon ?? '📝'

const LS_KEY = 'mglass_dashboard_myOnly'

export default function ManagerDashboardPage() {
  const router = useRouter()
  const [quotes, setQuotes]   = useState<Quote[]>([])
  const [clients, setClients] = useState<ClientWithMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [myEmail, setMyEmail]       = useState<string | null>(null)
  const [myUserId, setMyUserId]     = useState<string | null>(null)
  const [role, setRole]             = useState<'manager' | 'admin'>('manager')
  const [seeAllOrders, setSeeAllOrders] = useState(false)
  const [managers, setManagers]     = useState<string[]>([])
  const [viewAs, setViewAs]         = useState<string | null>(null)

  const [myOnly, setMyOnly] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(LS_KEY) !== 'false'
  })

  function toggleMyOnly(val: boolean) {
    setMyOnly(val)
    localStorage.setItem(LS_KEY, String(val))
  }

  // менеджер без разрешения — всегда только свои
  const canSeeAll = role === 'admin' || seeAllOrders
  const effectiveMyOnly = canSeeAll ? myOnly : true

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(false)
    try {
    const sb = createClient()

    const { data: { user } } = await sb.auth.getUser()
    const email = user?.email ?? null
    setMyEmail(email)
    if (user) setMyUserId(user.id)

    // Получаем профиль до запросов, чтобы использовать локальные переменные для фильтрации
    let localRole: 'manager' | 'admin' = 'manager'
    let localSeeAll = false
    if (user) {
      const { data: profile } = await sb.from('users').select('role,see_all_orders').eq('id', user.id).maybeSingle()
      localRole = profile?.role === 'admin' ? 'admin' : 'manager'
      localSeeAll = profile?.see_all_orders ?? false
      setRole(localRole)
      setSeeAllOrders(localSeeAll)
    }

    const localCanSeeAll = localRole === 'admin' || localSeeAll

    const now = new Date()
    const CRM_COLS = 'id,name,contact,phone,discount_percent,active,notes,created_at,crm_segment,crm_status,crm_score,crm_city,crm_manager,crm_next_contact,crm_notes'

    let quotesQuery = sb.from('b2b_orders')
      .select('id,client_id,client_name,total_after_discount,total_sale_inc_vat,discount_percent,margin_percent,notes,created_at,created_by')
      .order('created_at', { ascending: false })
      .limit(500)
    if (!localCanSeeAll && user) {
      quotesQuery = quotesQuery.eq('created_by', user.id)
    }

    const [{ data: qs }, { data: cls }, { data: orders }, { data: lastInts }] = await Promise.all([
      quotesQuery,
      sb.from('b2b_clients').select(CRM_COLS).eq('active', true),
      sb.from('b2b_orders')
        .select('client_id,total_after_discount,discount_percent,total_sale_inc_vat')
        .gte('created_at', new Date(now.getFullYear(), 0, 1).toISOString()),
      sb.from('b2b_interactions')
        .select('id,client_id,type,note,outcome,next_action,next_action_date,created_by,created_at')
        .order('created_at', { ascending: false })
        .limit(2000),
    ])

    setQuotes(qs ?? [])

    const totalByClient = new Map<number, number>()
    for (const o of orders ?? []) {
      const v = o.discount_percent > 0 ? o.total_after_discount : o.total_sale_inc_vat
      totalByClient.set(o.client_id, (totalByClient.get(o.client_id) ?? 0) + v)
    }
    const lastIntByClient = new Map<number, B2BInteraction>()
    for (const i of (lastInts ?? []) as B2BInteraction[]) {
      if (!lastIntByClient.has(i.client_id)) lastIntByClient.set(i.client_id, i)
    }

    const enriched = (cls ?? []).map((c: B2BClient) => ({
      ...c,
      crm: clientToCRM(c),
      lastInteraction: lastIntByClient.get(c.id) ?? null,
      yearTotal: totalByClient.get(c.id) ?? 0,
    }))
    setClients(enriched)

    // Collect unique manager emails for admin dropdown
    const mgrs = [...new Set(
      enriched.map((c: ClientWithMeta) => c.crm.manager_name).filter((m): m is string => !!m)
    )].sort()
    setManagers(mgrs)
    } catch (e) {
      console.error(e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // filterEmail — для клиентов CRM (по имени/email менеджера)
  const filterEmail = useMemo(() => {
    if (!effectiveMyOnly) return null
    return viewAs ?? myEmail
  }, [effectiveMyOnly, viewAs, myEmail])

  // filterUserId — для КП/заказов (по created_by UUID)
  const filterUserId = useMemo(() => {
    if (!effectiveMyOnly) return null
    if (viewAs) return null // admin смотрит другого менеджера по email, UUID неизвестен
    return myUserId
  }, [effectiveMyOnly, viewAs, myUserId])

  const noReply = useMemo(() =>
    quotes.filter(q => {
      const n = parseNotes(q.notes)
      if (n.status !== 'sent') return false
      if (daysAgo(q.created_at) < 2) return false
      if (filterUserId && q.created_by !== filterUserId) return false
      if (!filterUserId && filterEmail && n.manager_name !== filterEmail) return false
      return true
    }).slice(0, 10),
    [quotes, filterUserId, filterEmail]
  )

  const overdueContacts = useMemo(() =>
    clients.filter(c => {
      const d = daysUntil(c.crm.next_contact_date)
      if (d === null || d > 0) return false
      if (filterEmail && c.crm.manager_name !== filterEmail) return false
      return true
    }).sort((a, b) => (daysUntil(a.crm.next_contact_date) ?? 0) - (daysUntil(b.crm.next_contact_date) ?? 0))
      .slice(0, 10),
    [clients, filterEmail]
  )

  const hotClients = useMemo(() =>
    clients.filter(c => {
      if (c.crm.score !== 'A') return false
      if (c.crm.status !== 'active' && c.crm.status !== 'contacted') return false
      if (filterEmail && c.crm.manager_name !== filterEmail) return false
      return true
    }).sort((a, b) => b.yearTotal - a.yearTotal).slice(0, 5),
    [clients, filterEmail]
  )

  const myClients = useMemo(() => {
    const list = filterEmail
      ? clients.filter(c => c.crm.manager_name === filterEmail)
      : clients
    const revenue = list.reduce((s, c) => s + c.yearTotal, 0)
    const avgRevenue = list.length > 0 ? Math.round(revenue / list.length) : 0
    return { count: list.length, avgRevenue }
  }, [clients, filterEmail])

  const monthStart = useMemo(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d
  }, [])

  const monthStats = useMemo(() => {
    const thisMonth = quotes.filter(q => {
      if (new Date(q.created_at) < monthStart) return false
      if (filterUserId && q.created_by !== filterUserId) return false
      if (!filterUserId && filterEmail && parseNotes(q.notes).manager_name !== filterEmail) return false
      return true
    })
    const confirmed = thisMonth.filter(q => {
      const s = parseNotes(q.notes).status
      return s === 'confirmed' || s === 'agreed'
    })
    const total = confirmed.reduce((s, q) =>
      s + (q.discount_percent > 0 ? q.total_after_discount : q.total_sale_inc_vat), 0)
    const conversion = thisMonth.length > 0 ? Math.round(confirmed.length / thisMonth.length * 100) : 0
    const avgMargin = confirmed.length > 0
      ? Math.round(confirmed.reduce((s, q) => s + (q.margin_percent ?? 0), 0) / confirmed.length)
      : 0
    return { kpCount: thisMonth.length, orderCount: confirmed.length, total, conversion, avgMargin }
  }, [quotes, filterUserId, filterEmail, monthStart])

  if (error) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85] p-6">
      <div className="text-center">
        <p className="mb-3">Не удалось загрузить дашборд.</p>
        <button onClick={() => load()} className="px-4 py-2 bg-[#111110] text-white rounded-lg">Повторить</button>
      </div>
    </div>
  )
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  const activeFilterLabel = effectiveMyOnly
    ? (viewAs ? viewAs : 'мои')
    : 'все'

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="max-w-[1200px] mx-auto px-4 py-5">

        {/* Header + toggle */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h1 className="text-[16px] font-semibold text-[#111110] tracking-tight">Дашборд менеджера</h1>
            {myEmail && (
              <p className="text-[12px] text-[#9a9a95] mt-0.5">{myEmail}</p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Admin: viewAs dropdown */}
            {role === 'admin' && myOnly && (
              <select
                value={viewAs ?? ''}
                onChange={e => setViewAs(e.target.value || null)}
                className="bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#6b6b66] outline-none focus:border-[#111110]">
                <option value="">— мой</option>
                {managers.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}
            {/* Toggle — только для тех, кто может видеть все */}
            {canSeeAll && (
              <div className="flex bg-[#f0f0ec] rounded-lg p-0.5">
                <button
                  onClick={() => toggleMyOnly(true)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${effectiveMyOnly ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'}`}>
                  Только мои
                </button>
                <button
                  onClick={() => toggleMyOnly(false)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${!effectiveMyOnly ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'}`}>
                  Все
                </button>
              </div>
            )}
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          {[
            { label: 'КП в этом месяце', value: String(monthStats.kpCount), sub: 'отправлено' },
            { label: 'Заказов', value: String(monthStats.orderCount), sub: `конверсия ${monthStats.conversion}%` },
            { label: 'Выручка', value: monthStats.total > 0 ? fmt(monthStats.total) : '—', sub: 'подтверждённые' },
            { label: 'Средняя маржа', value: monthStats.avgMargin > 0 ? `${monthStats.avgMargin}%` : '—',
              sub: monthStats.avgMargin >= 30 ? '✅ норма' : monthStats.avgMargin > 0 ? '⚠️ низкая' : '' },
            { label: `Мои клиенты${myOnly ? '' : ' (все)'}`, value: String(myClients.count),
              sub: myClients.avgRevenue > 0 ? `ср. ${fmt(myClients.avgRevenue)}` : activeFilterLabel },
          ].map(k => (
            <div key={k.label} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">{k.label}</p>
              <p className="text-[20px] font-bold text-[#111110] font-mono leading-none">{k.value}</p>
              {k.sub && <p className="text-[11px] text-[#9a9a95] mt-1">{k.sub}</p>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Просроченные контакты */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[#f0f0ec] flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">Просроченные контакты</span>
              {overdueContacts.length > 0 && (
                <span className="text-[11px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{overdueContacts.length}</span>
              )}
            </div>
            {overdueContacts.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[#c4c4be]">Всё в порядке 👍</div>
            ) : (
              <div className="divide-y divide-[#f8f8f7]">
                {overdueContacts.map(c => {
                  const d = daysUntil(c.crm.next_contact_date)!
                  return (
                    <div key={c.id} onClick={() => router.push(`/b2b-crm/${c.id}`)}
                      className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-[#fafaf9] transition-colors">
                      <div>
                        <p className="text-[13px] font-medium text-[#111110]">{c.name}</p>
                        {c.lastInteraction && (
                          <p className="text-[11px] text-[#9a9a95] mt-0.5 truncate max-w-[220px]">
                            {typeIcon(c.lastInteraction.type)} {c.lastInteraction.note}
                          </p>
                        )}
                        {c.crm.manager_name && !myOnly && (
                          <p className="text-[10px] text-[#c4c4be] mt-0.5">{c.crm.manager_name}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[12px] font-semibold text-red-600">
                          {d === 0 ? 'сегодня' : `${-d} дн. назад`}
                        </span>
                        {c.phone && (
                          <div className="flex gap-2 mt-1 justify-end">
                            <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-[10px] text-green-600 border border-green-200 px-1.5 py-0.5 rounded hover:bg-green-50 transition-colors">
                              WhatsApp
                            </a>
                            <a href={`tel:${c.phone}`} onClick={e => e.stopPropagation()}
                              className="text-[10px] text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded hover:bg-blue-50 transition-colors">
                              Звонок
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* КП без ответа */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[#f0f0ec] flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">КП без ответа (&gt;2 дней)</span>
              {noReply.length > 0 && (
                <span className="text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">{noReply.length}</span>
              )}
            </div>
            {noReply.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[#c4c4be]">Все ответили 👍</div>
            ) : (
              <div className="divide-y divide-[#f8f8f7]">
                {noReply.map(q => {
                  const total = q.discount_percent > 0 ? q.total_after_discount : q.total_sale_inc_vat
                  const manager = parseNotes(q.notes).manager_name as string | null
                  return (
                    <div key={q.id} onClick={() => router.push('/b2b-quotes')}
                      className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-[#fafaf9] transition-colors">
                      <div>
                        <p className="text-[13px] font-medium text-[#111110]">{q.client_name}</p>
                        <p className="text-[11px] text-[#9a9a95] mt-0.5">
                          {new Date(q.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                        </p>
                        {manager && !myOnly && (
                          <p className="text-[10px] text-[#c4c4be] mt-0.5">{manager}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-semibold font-mono text-[#111110]">{fmt(total)}</p>
                        <p className="text-[11px] text-amber-600 mt-0.5">{daysAgo(q.created_at)} дн. ожидания</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Горячие клиенты A */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[#f0f0ec]">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">Горячие клиенты — класс A</span>
            </div>
            {hotClients.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-[#c4c4be]">Нет клиентов класса A</div>
            ) : (
              <div className="divide-y divide-[#f8f8f7]">
                {hotClients.map(c => {
                  const nc = daysUntil(c.crm.next_contact_date)
                  return (
                    <div key={c.id} onClick={() => router.push(`/b2b-crm/${c.id}`)}
                      className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-[#fafaf9] transition-colors">
                      <div>
                        <p className="text-[13px] font-medium text-[#111110]">{c.name}</p>
                        <p className="text-[11px] text-[#9a9a95] mt-0.5">{c.contact ?? c.phone ?? ''}</p>
                      </div>
                      <div className="text-right">
                        {c.yearTotal > 0 && (
                          <p className="text-[13px] font-semibold font-mono text-[#111110]">{fmt(c.yearTotal)}</p>
                        )}
                        {nc !== null && (
                          <p className={`text-[11px] mt-0.5 ${nc <= 0 ? 'text-red-600 font-semibold' : nc <= 3 ? 'text-amber-600' : 'text-[#9a9a95]'}`}>
                            {nc <= 0 ? `контакт просрочен ${-nc}д` : `контакт через ${nc}д`}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Быстрые ссылки */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-5">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-3">Быстрые действия</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { href: '/b2b-crm',        icon: '🗂️', label: 'B2B CRM' },
                { href: '/calculator/b2b', icon: '🧮', label: 'Новый просчёт' },
                { href: '/b2b-quotes',     icon: '📝', label: 'Просчёты' },
                { href: '/b2b-pipeline',   icon: '📊', label: 'Воронка продаж' },
                { href: '/b2b-production', icon: '⚙️', label: 'Производство' },
                { href: '/b2b-analytics',  icon: '📈', label: 'Аналитика' },
              ].map(l => (
                <Link key={l.href} href={l.href}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[#e4e4e0] text-[13px] text-[#111110] hover:bg-[#f8f8f7] transition-colors">
                  <span>{l.icon}</span> {l.label}
                </Link>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
