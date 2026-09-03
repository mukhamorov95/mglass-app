'use client'

import { useEffect, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase-browser'
import Link from 'next/link'
import LaunchOrderModal from '@/components/LaunchOrderModal'
import type { LaunchOrderPayload } from '@/components/LaunchOrderModal'
import type { FinancialSettings } from '@/lib/types'
import { computeMarginStatus, MARGIN_STATUS_LABELS } from '@/lib/types'

type Calc = {
  id: number
  created_at: string
  created_by: string | null
  product_type: string
  input_data: Record<string, unknown>
  cost_breakdown: Record<string, unknown>
  financial_breakdown: Record<string, unknown>
  base_price: number
  discount: number
  partner_percent: number
  final_price: number
  margin: number
  profit: number
  manager_bonus: number
  status: string
  client_text: string | null
  client_name: string | null
  client_phone: string | null
  order_group_id: string | null
  order_number: string | null
}

type Props = {
  isAdmin: boolean
  canViewAll: boolean   // admin/ceo или менеджер с can_view_all_deals — видит все КП
  usersMap: Record<string, string>
  allSettings: FinancialSettings[]
  userId: string | null
}

const PRODUCT_LABELS: Record<string, { label: string; color: string; emoji: string }> = {
  mirror:          { label: 'Зеркало',  color: 'bg-blue-50 text-blue-700',    emoji: '🪞' },
  loft:            { label: 'Лофт',     color: 'bg-orange-50 text-orange-700', emoji: '🏗️' },
  shower:          { label: 'Душевая',  color: 'bg-cyan-50 text-cyan-700',     emoji: '🚿' },
  shower_standard: { label: 'Душевая',  color: 'bg-cyan-50 text-cyan-700',     emoji: '🚿' },
  shower_budget:   { label: 'Душевая',  color: 'bg-cyan-50 text-cyan-700',     emoji: '🚿' },
  order:           { label: 'Заказ',    color: 'bg-purple-50 text-purple-700', emoji: '📦' },
  quick:           { label: 'Быстрый',  color: 'bg-[#f0f0ec] text-[#6b6b66]',  emoji: '⚡' },
}

// Sales flow statuses
const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  draft:    { label: 'Черновик',   color: 'bg-gray-100 text-gray-600',         dot: 'bg-gray-400' },
  sent:     { label: 'Отправлено', color: 'bg-blue-100 text-blue-700',         dot: 'bg-blue-500' },
  thinking: { label: 'Думает',     color: 'bg-amber-100 text-amber-700',       dot: 'bg-amber-500' },
  approved: { label: 'Согласовано',color: 'bg-emerald-100 text-emerald-700',   dot: 'bg-emerald-500' },
  launched: { label: 'Запущено',   color: 'bg-purple-100 text-purple-700',     dot: 'bg-purple-500' },
  rejected: { label: 'Отказ',      color: 'bg-red-100 text-red-600',           dot: 'bg-red-400' },
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

// Mirrors the same deduplication logic as the KP print page:
// each item's final_price includes services — delivery must be counted once per group.
function computeGroupTotal(items: Calc[]): number {
  const svcMap = new Map<string, { total: number; isDelivery: boolean }>()
  let productSum = 0
  for (const item of items) {
    const svcLines = (item.financial_breakdown?.serviceLines ?? []) as { name: string; total: number }[]
    const svcTotal = svcLines.filter(s => s.total > 0).reduce((s, l) => s + l.total, 0)
    productSum += item.final_price - svcTotal
    for (const svc of svcLines) {
      if (svc.total <= 0) continue
      const isDelivery = svc.name.toLowerCase().includes('доставк')
      const existing = svcMap.get(svc.name)
      if (existing) {
        if (!isDelivery) existing.total += svc.total
      } else {
        svcMap.set(svc.name, { total: svc.total, isDelivery })
      }
    }
  }
  const svcSum = Array.from(svcMap.values()).reduce((s, v) => s + v.total, 0)
  return productSum + svcSum
}

function getDesc(c: Calc): string {
  const d = c.input_data
  if (c.product_type === 'mirror') return `${d.width}×${d.height} мм`
  if (c.product_type === 'loft')   return `${d.width}×${d.height} мм${d.sections ? `, ${d.sections} секц.` : ''}`
  if (c.product_type.startsWith('shower')) {
    const dims = (d.dimStr as string) ?? `${d.width}×${d.height} мм`
    const tier = d.tier === 'budget' ? ' · Бюджет' : ''
    return dims + tier
  }
  if (c.product_type === 'quick') {
    const cart = Array.isArray(d.cart) ? d.cart as { title?: string }[] : []
    if (cart.length > 1) return `${cart.length} изделий`
    return (cart[0]?.title as string) || (d.title as string) || 'быстрый расчёт'
  }
  return ''
}

// ── Glass area helpers ────────────────────────────────────────────────────────

type GlassEntry = { name: string; mm: number | null; areaSqm: number }

function calcItemArea(c: Calc): GlassEntry | null {
  const d = c.input_data
  const w = Number(d.width)  || 0
  const h = Number(d.height) || 0
  if (!w || !h) return null

  if (c.product_type === 'mirror') {
    const mm   = Number(d.mirrorMm || d.thickness) || null
    const name = (d.mirrorName as string || 'Зеркало').replace(/^зеркало\s*/i, '').trim() || 'Зеркало'
    let area = 0
    if (d.shape === 'circle') area = Math.PI * (w / 2000) ** 2
    else if (d.shape === 'oval') area = Math.PI * (w / 1000) * (h / 1000) / 4
    else area = (w / 1000) * (h / 1000)
    return { name, mm, areaSqm: area }
  }
  if (c.product_type === 'loft') {
    const mm      = Number(d.glassThickness || d.thickness) || null
    const name    = (d.glassName as string || 'Стекло').trim() || 'Стекло'
    const sections = Number(d.sections) || 1
    return { name, mm, areaSqm: (w / 1000) * (h / 1000) * sections }
  }
  if (c.product_type.startsWith('shower')) {
    const mm   = Number(d.thickness) || null
    const name = (d.glassType as string || 'Стекло').trim() || 'Стекло'
    return { name, mm, areaSqm: (w / 1000) * (h / 1000) }
  }
  return null
}

function aggregateGlass(items: Calc[]): (GlassEntry & { count: number })[] {
  const map = new Map<string, GlassEntry & { count: number }>()
  for (const c of items) {
    const g = calcItemArea(c)
    if (!g || g.areaSqm <= 0) continue
    const key = `${g.name}|${g.mm ?? ''}`
    const ex = map.get(key)
    if (ex) { ex.areaSqm += g.areaSqm; ex.count++ }
    else map.set(key, { ...g, count: 1 })
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

function getProductName(c: Calc): string {
  const d = c.input_data
  const label = PRODUCT_LABELS[c.product_type]?.label ?? c.product_type
  if (c.product_type === 'mirror') return `${label} ${d.width}×${d.height} мм`
  if (c.product_type === 'loft') {
    const dims = d.sections ? `${d.width}×${d.height} мм, ${d.sections} секц.` : `${d.width}×${d.height} мм`
    return `Лофт-перегородка ${dims}`
  }
  if (c.product_type.startsWith('shower')) {
    const tier = d.tier === 'budget' ? ' Бюджет' : ''
    const dims = (d.dimStr as string) ?? `${d.width}×${d.height} мм`
    return `Душевая ${dims}${tier}`
  }
  return label
}

function buildLaunchPayload(c: Calc): LaunchOrderPayload {
  const costLines = (c.cost_breakdown?.lines ?? []) as { name: string; qty: number; unit: string; price?: number; total: number }[]
  const svcLines  = (c.financial_breakdown?.serviceLines ?? []) as { name: string; qty?: number; unit?: string; total: number }[]
  const totalCost = (c.cost_breakdown?.totalCost as number) ?? 0
  return {
    product_type:    c.product_type,
    product_name:    getProductName(c),
    dimensions_text: getDesc(c),
    unit_cost_price: totalCost,
    unit_sale_price: c.final_price,
    discount_percent: c.discount,
    line_cost_price: totalCost,
    line_sale_price: c.final_price,
    margin_percent:  c.margin,
    input_snapshot:  c.input_data,
    cost_snapshot:   c.cost_breakdown ?? {},
    materials_bom:   costLines.map(l => ({ name: l.name, qty: l.qty, unit: l.unit, unit_cost: l.price ?? 0, total: l.total })),
    hardware_bom:    [],
    services_bom:    svcLines.map(l => ({ name: l.name, qty: l.qty ?? 1, unit: l.unit ?? 'шт', unit_cost: l.total, total: l.total })),
    calculation_id:  c.id,
  }
}

function findSettings(c: Calc, all: FinancialSettings[]): FinancialSettings | null {
  return (
    all.find(s => s.product_type === c.product_type) ??
    all.find(s => c.product_type === 'shower_budget' ? s.tier === 'budget' : s.tier === 'standard') ??
    all[0] ?? null
  )
}

export default function CalculationsClient({ isAdmin, canViewAll, usersMap, allSettings, userId }: Props) {
  const [calcs, setCalcs]         = useState<Calc[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [filterType, setFilterType] = useState<'all' | 'mirror' | 'loft' | 'shower'>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [launchCalc, setLaunchCalc] = useState<Calc | null>(null)
  const [duplicating, setDuplicating] = useState<number | null>(null)
  // inline client/order editing — single calc
  const [editingClient, setEditingClient] = useState<number | null>(null)
  const [orderNumDraft, setOrderNumDraft]   = useState('')
  const [clientNameDraft, setClientNameDraft] = useState('')
  const [clientPhoneDraft, setClientPhoneDraft] = useState('')
  const [savingClient, setSavingClient] = useState(false)
  // inline client/order editing — group
  const [editingGroup, setEditingGroup]       = useState<string | null>(null)
  const [groupOrderNum, setGroupOrderNum]     = useState('')
  const [groupClientName, setGroupClientName] = useState('')
  const [groupClientPhone, setGroupClientPhone] = useState('')
  const [savingGroup, setSavingGroup]         = useState(false)

  // eslint-disable-next-line react-hooks/immutability
  useEffect(() => { fetchCalcs() }, [])

  async function fetchCalcs() {
    const supabase = createClient()
    let query = supabase
      .from('calculations')
      .select('id,created_at,created_by,product_type,input_data,cost_breakdown,financial_breakdown,base_price,discount,partner_percent,final_price,margin,profit,manager_bonus,status,client_text,client_name,client_phone,order_group_id,order_number')
      .order('created_at', { ascending: false })
    if (!canViewAll && userId) {
      query = query.eq('created_by', userId)
    }
    const { data } = await query
    setCalcs((data ?? []) as Calc[])
    setLoading(false)
  }

  async function updateStatus(id: number, status: string) {
    const supabase = createClient()
    await supabase.from('calculations').update({ status }).eq('id', id)
    setCalcs(prev => prev.map(c => c.id === id ? { ...c, status } : c))
  }

  async function deleteCalc(id: number) {
    if (!confirm('Удалить этот расчёт?')) return
    const supabase = createClient()
    await supabase.from('calculations').delete().eq('id', id)
    setCalcs(prev => prev.filter(c => c.id !== id))
  }

  async function deleteGroup(groupId: string) {
    if (!confirm('Удалить весь заказ (все изделия в группе)?')) return
    const supabase = createClient()
    await supabase.from('calculations').delete().eq('order_group_id', groupId)
    setCalcs(prev => prev.filter(c => c.order_group_id !== groupId))
  }

  async function updateGroupStatus(groupId: string, status: string) {
    const supabase = createClient()
    await supabase.from('calculations').update({ status }).eq('order_group_id', groupId)
    setCalcs(prev => prev.map(c => c.order_group_id === groupId ? { ...c, status } : c))
  }

  async function duplicateCalc(c: Calc) {
    setDuplicating(c.id)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const { data } = await supabase
      .from('calculations')
      .insert({
        product_type: c.product_type, input_data: c.input_data,
        cost_breakdown: c.cost_breakdown, financial_breakdown: c.financial_breakdown,
        base_price: c.base_price, discount: c.discount, partner_percent: c.partner_percent,
        final_price: c.final_price, margin: c.margin, profit: c.profit,
        manager_bonus: c.manager_bonus, client_text: c.client_text,
        client_name: c.client_name, client_phone: c.client_phone,
        created_by: session?.user.id ?? null, status: 'draft',
      })
      .select('id,created_at,created_by,product_type,input_data,cost_breakdown,financial_breakdown,base_price,discount,partner_percent,final_price,margin,profit,manager_bonus,status,client_text,client_name,client_phone,order_group_id')
      .single()
    if (data) setCalcs(prev => [data as Calc, ...prev])
    setDuplicating(null)
  }

  function openClientEdit(c: Calc) {
    setEditingClient(c.id)
    setOrderNumDraft(c.order_number ?? '')
    setClientNameDraft(c.client_name ?? '')
    setClientPhoneDraft(c.client_phone ?? '')
  }

  async function saveClientInfo(id: number) {
    setSavingClient(true)
    const supabase = createClient()
    await supabase.from('calculations').update({
      order_number: orderNumDraft.trim() || null,
      client_name:  clientNameDraft.trim() || null,
      client_phone: clientPhoneDraft.trim() || null,
    }).eq('id', id)
    setCalcs(prev => prev.map(c => c.id === id
      ? { ...c, order_number: orderNumDraft.trim() || null, client_name: clientNameDraft.trim() || null, client_phone: clientPhoneDraft.trim() || null }
      : c
    ))
    setEditingClient(null)
    setSavingClient(false)
  }

  function openGroupEdit(items: Calc[]) {
    const first = items[0]
    setEditingGroup(first.order_group_id!)
    setGroupOrderNum(first.order_number ?? '')
    setGroupClientName(first.client_name ?? '')
    setGroupClientPhone(first.client_phone ?? '')
  }

  async function saveGroupInfo(groupId: string) {
    setSavingGroup(true)
    const supabase = createClient()
    await supabase.from('calculations').update({
      order_number: groupOrderNum.trim() || null,
      client_name:  groupClientName.trim() || null,
      client_phone: groupClientPhone.trim() || null,
    }).eq('order_group_id', groupId)
    setCalcs(prev => prev.map(c => c.order_group_id === groupId
      ? { ...c, order_number: groupOrderNum.trim() || null, client_name: groupClientName.trim() || null, client_phone: groupClientPhone.trim() || null }
      : c
    ))
    setEditingGroup(null)
    setSavingGroup(false)
  }

  const filtered = useMemo(() => {
    let list = calcs
    if (filterType !== 'all') {
      list = list.filter(c =>
        filterType === 'shower'
          ? c.product_type.startsWith('shower')
          : c.product_type === filterType
      )
    }
    if (filterStatus !== 'all') {
      list = list.filter(c => c.status === filterStatus)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(c =>
        c.client_name?.toLowerCase().includes(q) ||
        c.client_phone?.includes(q) ||
        (usersMap[c.created_by ?? ''] ?? '').toLowerCase().includes(q) ||
        getDesc(c).toLowerCase().includes(q)
      )
    }
    return list
  }, [calcs, filterType, filterStatus, search])

  const defaultSettings = allSettings[0]

  return (
    <div className="min-h-screen bg-[#f5f5f3]">
      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[18px] font-bold text-[#111110]">История расчётов</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">{calcs.length} расчётов</p>
          </div>
          <div className="flex gap-1.5">
            {[
              { href: '/calculator/shower', label: '🚿 Душевая' },
              { href: '/calculator/mirror', label: '🪞 Зеркало' },
              { href: '/calculator/loft',   label: '🏗️ Лофт' },
              { href: '/calculator/railing', label: '🪜 Ограждение' },
            ].map(l => (
              <Link key={l.href} href={l.href}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#e4e4e0] bg-white text-[#4b4b47] hover:bg-[#fafaf9] transition-colors">
                + {l.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9a9a95]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по клиенту, телефону, параметрам..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-[#e4e4e0] rounded-xl text-[13px] text-[#111110] placeholder:text-[#c4c4be] focus:outline-none focus:border-[#9a9a95] transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9a9a95] hover:text-[#4b4b47]">
              ✕
            </button>
          )}
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {/* Product type */}
          <div className="flex gap-1">
            {([
              { k: 'all',    l: 'Все' },
              { k: 'shower', l: '🚿 Душевые' },
              { k: 'mirror', l: '🪞 Зеркала' },
              { k: 'loft',   l: '🏗️ Лофт' },
            ] as const).map(f => {
              const cnt = f.k === 'all' ? calcs.length
                : f.k === 'shower' ? calcs.filter(c => c.product_type.startsWith('shower')).length
                : calcs.filter(c => c.product_type === f.k).length
              return (
                <button key={f.k} onClick={() => setFilterType(f.k)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${filterType === f.k ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#fafaf9]'}`}>
                  {f.l} <span className="opacity-60">({cnt})</span>
                </button>
              )
            })}
          </div>

          <div className="w-px h-5 bg-[#e4e4e0]" />

          {/* Status */}
          <div className="flex gap-1 flex-wrap">
            {[
              { k: 'all', l: 'Все статусы' },
              ...Object.entries(STATUS_META).map(([k, v]) => ({ k, l: v.label }))
            ].map(f => (
              <button key={f.k} onClick={() => setFilterStatus(f.k)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${filterStatus === f.k ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#fafaf9]'}`}>
                {f.l}
              </button>
            ))}
          </div>
        </div>

        {/* Cards */}
        {loading ? (
          <div className="py-16 text-center text-[#9a9a95] text-sm">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[#9a9a95] text-sm mb-2">Расчётов не найдено</p>
            {search && <button onClick={() => setSearch('')} className="text-blue-600 text-xs hover:underline">Сбросить поиск</button>}
          </div>
        ) : (() => {
          // Build display list: group by order_group_id
          const seen = new Set<string>()
          const rows: Array<{ type: 'single'; calc: Calc } | { type: 'group'; items: Calc[] }> = []
          for (const c of filtered) {
            if (c.order_group_id) {
              if (!seen.has(c.order_group_id)) {
                seen.add(c.order_group_id)
                const groupItems = filtered.filter(x => x.order_group_id === c.order_group_id)
                rows.push({ type: 'group', items: groupItems })
              }
            } else {
              rows.push({ type: 'single', calc: c })
            }
          }

          return (
            <div className="space-y-2">
              {rows.map((row, rowIdx) => {
                if (row.type === 'group') {
                  const { items: gi } = row
                  const groupTotal = computeGroupTotal(gi)
                  const groupCost  = gi.reduce((s, x) => s + ((x.cost_breakdown?.totalCost as number) ?? 0), 0)
                  const groupProfit= gi.reduce((s, x) => s + x.profit, 0)
                  const avgMargin  = gi.reduce((s, x) => s + x.margin, 0) / gi.length
                  const st = STATUS_META[gi[0].status] ?? STATUS_META.draft
                  const managerName = gi[0].created_by ? (usersMap[gi[0].created_by] ?? '') : ''
                  const mStatus = computeMarginStatus(avgMargin, defaultSettings ?? { default_margin: 40, min_margin: 25 })
                  const marginColor = mStatus === 'green' ? 'text-emerald-600' : mStatus === 'yellow' ? 'text-amber-600' : 'text-red-600'
                  const marginBadge = mStatus === 'green' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : mStatus === 'yellow' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'

                  const isEditingThisGroup = editingGroup === gi[0].order_group_id
                  const displayClientName = gi[0].client_name
                  const displayOrderNumber = gi[0].order_number

                  return (
                    <div key={`group-${rowIdx}`} className="bg-white rounded-xl border border-purple-200 overflow-hidden hover:border-purple-300 transition-colors">
                      <div className="px-4 py-3.5">
                        {/* Top row */}
                        <div className="flex items-start gap-3 mb-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700">
                                📦 Заказ · {gi.length} {gi.length === 1 ? 'изделие' : gi.length < 5 ? 'изделия' : 'изделий'}
                              </span>
                              {displayOrderNumber && (
                                <span className="text-[11px] font-mono font-semibold text-[#4b4b47] bg-[#f5f5f3] px-2 py-0.5 rounded-md">
                                  №{displayOrderNumber}
                                </span>
                              )}
                            </div>
                            {/* Client info / edit */}
                            {isEditingThisGroup ? (
                              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                <input autoFocus value={groupOrderNum} onChange={e => setGroupOrderNum(e.target.value)}
                                  placeholder="Номер заказа"
                                  className="border border-[#e4e4e0] rounded-lg px-2.5 py-1 text-[12px] w-28 focus:outline-none focus:border-purple-400" />
                                <input value={groupClientName} onChange={e => setGroupClientName(e.target.value)}
                                  placeholder="Имя клиента"
                                  className="border border-[#e4e4e0] rounded-lg px-2.5 py-1 text-[12px] w-32 focus:outline-none focus:border-purple-400" />
                                <input value={groupClientPhone} onChange={e => setGroupClientPhone(e.target.value)}
                                  placeholder="+7 000 000-00-00"
                                  className="border border-[#e4e4e0] rounded-lg px-2.5 py-1 text-[12px] w-36 focus:outline-none focus:border-purple-400" />
                                <button onClick={() => saveGroupInfo(gi[0].order_group_id!)} disabled={savingGroup}
                                  className="px-2.5 py-1 bg-purple-600 text-white rounded-lg text-[11px] font-semibold disabled:opacity-50 hover:bg-purple-700 transition-colors">
                                  {savingGroup ? '...' : 'Сохранить'}
                                </button>
                                <button onClick={() => setEditingGroup(null)} className="text-[11px] text-[#9a9a95] hover:text-[#4b4b47]">Отмена</button>
                              </div>
                            ) : (
                              <button onClick={() => openGroupEdit(gi)} className="flex items-center gap-1.5 text-left group mt-0.5">
                                {displayClientName ? (
                                  <span className="text-[13px] font-semibold text-[#111110]">{displayClientName}</span>
                                ) : (
                                  <span className="text-[12px] text-[#c4c4be] group-hover:text-purple-500 transition-colors">+ Клиент / номер заказа</span>
                                )}
                                {gi[0].client_phone && <span className="text-[11px] text-[#9a9a95]">· {gi[0].client_phone}</span>}
                                {displayClientName && (
                                  <span className="text-[10px] text-[#c4c4be] group-hover:text-[#9a9a95] transition-colors ml-0.5">✎</span>
                                )}
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[11px] text-[#9a9a95]">
                              {new Date(gi[0].created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' })}
                            </span>
                            {(isAdmin || canViewAll) && managerName && (
                              <span className="text-[11px] text-[#9a9a95] border border-[#e4e4e0] px-1.5 py-0.5 rounded">{managerName}</span>
                            )}
                            <select value={gi[0].status} onChange={e => updateGroupStatus(gi[0].order_group_id!, e.target.value)}
                              className={`text-[11px] font-semibold px-2 py-1 rounded-full cursor-pointer border-0 outline-none ${st.color}`}>
                              {Object.entries(STATUS_META).map(([val, { label }]) => (
                                <option key={val} value={val}>{label}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Items list */}
                        <div className="mb-3 space-y-1.5">
                          {gi.map(item => {
                            const p = PRODUCT_LABELS[item.product_type] ?? { emoji: '📋', label: item.product_type, color: 'bg-gray-100 text-gray-600' }
                            const svcLines = (item.financial_breakdown?.serviceLines ?? []) as { name: string; total: number }[]
                            const svcTotal = svcLines.filter(s => s.total > 0).reduce((s, l) => s + l.total, 0)
                            const productPrice = item.final_price - svcTotal
                            const glassInfo = calcItemArea(item)
                            return (
                              <div key={item.id} className="flex items-center gap-2 bg-[#fafaf9] rounded-lg px-3 py-1.5">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.color}`}>{p.emoji} {p.label}</span>
                                <span className="text-[12px] text-[#4b4b47]">{getDesc(item)}</span>
                                {glassInfo?.mm && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 whitespace-nowrap flex-shrink-0">
                                    {glassInfo.mm} мм
                                  </span>
                                )}
                                {glassInfo && (
                                  <span className="text-[10px] text-[#9a9a95] whitespace-nowrap flex-shrink-0">
                                    {glassInfo.areaSqm.toFixed(2)} м²
                                  </span>
                                )}
                                <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                                  {item.discount > 0 && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                                      −{item.discount}%
                                    </span>
                                  )}
                                  <span className="font-mono text-[12px] text-[#111110] font-semibold">{fmt(productPrice)}</span>
                                </div>
                                <Link href={`/calculations/${item.id}`}
                                  className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[#e4e4e0] bg-white text-[#4b4b47] hover:bg-[#f0f0ee] transition-colors whitespace-nowrap">
                                  Открыть
                                </Link>
                              </div>
                            )
                          })}
                        </div>

                        {/* Glass summary by type + thickness */}
                        {(() => {
                          const glass = aggregateGlass(gi)
                          if (!glass.length) return null
                          return (
                            <div className="mb-3 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200 flex flex-wrap gap-x-4 gap-y-1">
                              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest self-center">Стекло</span>
                              {glass.map((g, i) => (
                                <div key={i} className="flex items-center gap-1">
                                  <span className="text-[11px] text-slate-600 font-medium">{g.name}</span>
                                  {g.mm && <span className="text-[10px] px-1 py-0.5 rounded bg-slate-200 text-slate-500 font-mono">{g.mm} мм</span>}
                                  <span className="text-[11px] font-semibold text-slate-700">{g.areaSqm.toFixed(2)} м²</span>
                                  {g.count > 1 && <span className="text-[10px] text-slate-400">×{g.count}</span>}
                                </div>
                              ))}
                            </div>
                          )
                        })()}

                        {/* Financials */}
                        <div className="flex items-center gap-4 mb-3 flex-wrap">
                          <div className="flex items-baseline gap-1">
                            <span className="text-[11px] text-[#9a9a95]">Итого</span>
                            <span className="text-[15px] font-bold tabular-nums text-[#111110]">{fmt(groupTotal)}</span>
                          </div>
                          {groupCost > 0 && (
                            <div className="flex items-baseline gap-1">
                              <span className="text-[11px] text-[#9a9a95]">С/С</span>
                              <span className="text-[12px] tabular-nums text-[#6b6b66]">{fmt(groupCost)}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[13px] font-bold ${marginColor}`}>{avgMargin.toFixed(1)}%</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${marginBadge}`}>
                              {MARGIN_STATUS_LABELS[mStatus]}
                            </span>
                          </div>
                          {groupProfit > 0 && (
                            <div className="flex items-baseline gap-1">
                              <span className="text-[11px] text-[#9a9a95]">Прибыль</span>
                              <span className="text-[12px] tabular-nums text-emerald-600 font-semibold">+{fmt(groupProfit)}</span>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {isAdmin && (
                            <button onClick={() => deleteGroup(gi[0].order_group_id!)}
                              className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-red-100 text-red-500 hover:bg-red-50 transition-colors">
                              Удалить заказ
                            </button>
                          )}
                          <a href={`/calculations/order/${gi[0].order_group_id}/print`} target="_blank" rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-blue-100 text-blue-600 hover:bg-blue-50 transition-colors">
                            PDF КП
                          </a>
                          <div className="flex-1" />
                          <button onClick={() => setLaunchCalc(gi[0])}
                            className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors">
                            Запустить заказ →
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                }

                // Single calc
                const c = row.calc
                const prod     = PRODUCT_LABELS[c.product_type] ?? { label: c.product_type, color: 'bg-gray-100 text-gray-600', emoji: '📋' }
                const desc     = getDesc(c)
                const totalCost = (c.cost_breakdown?.totalCost as number) ?? 0
                const mStatus  = computeMarginStatus(c.margin, defaultSettings ?? { default_margin: 40, min_margin: 25 })
                const marginColor = mStatus === 'green' ? 'text-emerald-600' : mStatus === 'yellow' ? 'text-amber-600' : 'text-red-600'
                const marginBadge = mStatus === 'green' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : mStatus === 'yellow' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'
                const st = STATUS_META[c.status] ?? STATUS_META.draft
                const managerName = c.created_by ? (usersMap[c.created_by] ?? '') : ''
                const isEditingThis = editingClient === c.id

                return (
                  <div key={c.id} className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden hover:border-[#c4c4be] transition-colors">
                    <div className="px-4 py-3.5">
                      <div className="flex items-start gap-3 mb-2.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${prod.color}`}>
                              {prod.emoji} {prod.label}
                            </span>
                            {desc && <span className="text-[13px] font-semibold text-[#111110]">{desc}</span>}
                          </div>
                          {isEditingThis ? (
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              <input autoFocus value={orderNumDraft} onChange={e => setOrderNumDraft(e.target.value)}
                                placeholder="Номер заказа"
                                className="border border-[#e4e4e0] rounded-lg px-2.5 py-1 text-[12px] w-28 focus:outline-none focus:border-blue-400" />
                              <input value={clientNameDraft} onChange={e => setClientNameDraft(e.target.value)}
                                placeholder="Имя клиента"
                                className="border border-[#e4e4e0] rounded-lg px-2.5 py-1 text-[12px] w-32 focus:outline-none focus:border-blue-400" />
                              <input value={clientPhoneDraft} onChange={e => setClientPhoneDraft(e.target.value)}
                                placeholder="+7 000 000-00-00"
                                className="border border-[#e4e4e0] rounded-lg px-2.5 py-1 text-[12px] w-36 focus:outline-none focus:border-blue-400" />
                              <button onClick={() => saveClientInfo(c.id)} disabled={savingClient}
                                className="px-2.5 py-1 bg-[#111110] text-white rounded-lg text-[11px] font-semibold disabled:opacity-50">
                                {savingClient ? '...' : 'Сохранить'}
                              </button>
                              <button onClick={() => setEditingClient(null)} className="text-[11px] text-[#9a9a95] hover:text-[#4b4b47]">Отмена</button>
                            </div>
                          ) : (
                            <button onClick={() => openClientEdit(c)} className="flex items-center gap-1.5 text-left group">
                              {c.order_number && (
                                <span className="text-[11px] font-mono font-semibold text-[#4b4b47] bg-[#f5f5f3] px-1.5 py-0.5 rounded">№{c.order_number}</span>
                              )}
                              {c.client_name ? (
                                <span className="text-[13px] font-semibold text-[#111110]">{c.client_name}</span>
                              ) : (
                                <span className="text-[12px] text-[#c4c4be] group-hover:text-blue-500 transition-colors">+ Клиент / номер заказа</span>
                              )}
                              {c.client_phone && <span className="text-[11px] text-[#9a9a95]">· {c.client_phone}</span>}
                              {(c.client_name || c.order_number) && (
                                <span className="text-[10px] text-[#c4c4be] group-hover:text-[#9a9a95] transition-colors">✎</span>
                              )}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[11px] text-[#9a9a95]">
                            {new Date(c.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit' })}
                          </span>
                          {(isAdmin || canViewAll) && managerName && (
                            <span className="text-[11px] text-[#9a9a95] border border-[#e4e4e0] px-1.5 py-0.5 rounded">{managerName}</span>
                          )}
                          <select value={c.status} onChange={e => updateStatus(c.id, e.target.value)}
                            className={`text-[11px] font-semibold px-2 py-1 rounded-full cursor-pointer border-0 outline-none ${st.color}`}>
                            {Object.entries(STATUS_META).map(([val, { label }]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 mb-3 flex-wrap">
                        <div className="flex items-baseline gap-1">
                          <span className="text-[11px] text-[#9a9a95]">Цена</span>
                          <span className="text-[15px] font-bold tabular-nums text-[#111110]">{fmt(c.final_price)}</span>
                        </div>
                        {totalCost > 0 && (
                          <div className="flex items-baseline gap-1">
                            <span className="text-[11px] text-[#9a9a95]">С/С</span>
                            <span className="text-[12px] tabular-nums text-[#6b6b66]">{fmt(totalCost)}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[13px] font-bold ${marginColor}`}>{c.margin.toFixed(1)}%</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${marginBadge}`}>
                            {MARGIN_STATUS_LABELS[mStatus]}
                          </span>
                        </div>
                        {c.profit > 0 && (
                          <div className="flex items-baseline gap-1">
                            <span className="text-[11px] text-[#9a9a95]">Прибыль</span>
                            <span className="text-[12px] tabular-nums text-emerald-600 font-semibold">+{fmt(c.profit)}</span>
                          </div>
                        )}
                        {c.discount > 0 && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                            −{c.discount}% скидка
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/calculations/${c.id}`}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[#e4e4e0] bg-white text-[#4b4b47] hover:bg-[#fafaf9] transition-colors">
                          Открыть
                        </Link>
                        <a href={`/calculations/${c.id}/print`} target="_blank" rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-blue-100 text-blue-600 hover:bg-blue-50 transition-colors">
                          PDF КП
                        </a>
                        <button onClick={() => duplicateCalc(c)} disabled={duplicating === c.id}
                          className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[#e4e4e0] bg-white text-[#4b4b47] hover:bg-[#fafaf9] disabled:opacity-50 transition-colors">
                          {duplicating === c.id ? '...' : 'Дублировать'}
                        </button>
                        {isAdmin && (
                          <button onClick={() => deleteCalc(c.id)}
                            className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-red-100 text-red-500 hover:bg-red-50 transition-colors">
                            Удалить
                          </button>
                        )}
                        <div className="flex-1" />
                        <button onClick={() => setLaunchCalc(c)}
                          className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors">
                          Запустить заказ →
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>

      <LaunchOrderModal
        isOpen={!!launchCalc}
        onClose={() => setLaunchCalc(null)}
        payload={launchCalc ? buildLaunchPayload(launchCalc) : null}
        settings={launchCalc ? findSettings(launchCalc, allSettings) : null}
      />
    </div>
  )
}
