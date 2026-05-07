'use client'

import { useEffect, useState } from 'react'
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
}

type Props = {
  isAdmin: boolean
  usersMap: Record<string, string>
  allSettings: FinancialSettings[]
}

const PRODUCT_LABELS: Record<string, { label: string; color: string }> = {
  mirror:          { label: 'Зеркало',    color: 'bg-blue-50 text-blue-700' },
  loft:            { label: 'Лофт',       color: 'bg-orange-50 text-orange-700' },
  shower:          { label: 'Душевая',    color: 'bg-cyan-50 text-cyan-700' },
  shower_standard: { label: 'Душевая',    color: 'bg-cyan-50 text-cyan-700' },
  shower_budget:   { label: 'Душевая',    color: 'bg-cyan-50 text-cyan-700' },
  order:           { label: 'Заказ',      color: 'bg-purple-50 text-purple-700' },
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft:    { label: 'Черновик',  color: 'bg-gray-100 text-gray-600' },
  sent:     { label: 'Отправлен', color: 'bg-blue-100 text-blue-700' },
  approved: { label: 'Принят',    color: 'bg-green-100 text-green-700' },
  rejected: { label: 'Отклонён', color: 'bg-red-100 text-red-600' },
}

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

function getDescription(c: Calc): string {
  const d = c.input_data
  if (c.product_type === 'mirror') return `${d.width}×${d.height} мм`
  if (c.product_type === 'loft')   return `${d.width}×${d.height} мм${d.sections ? `, ${d.sections} секц.` : ''}`
  if (c.product_type === 'shower' || c.product_type === 'shower_standard' || c.product_type === 'shower_budget') {
    const tier = d.tier === 'budget' ? 'Бюджет' : 'Стандарт'
    const dims = d.dimStr ?? `${d.width}×${d.height} мм`
    return `${dims} — ${tier}`
  }
  return ''
}

function getProductName(c: Calc): string {
  const d = c.input_data
  if (c.product_type === 'mirror') return `Зеркало ${d.width}×${d.height} мм`
  if (c.product_type === 'loft') {
    const dims = d.sections ? `${d.width}×${d.height} мм, ${d.sections} секц.` : `${d.width}×${d.height} мм`
    return `Лофт-перегородка ${dims}`
  }
  if (c.product_type === 'shower' || c.product_type === 'shower_standard' || c.product_type === 'shower_budget') {
    const tier = d.tier === 'budget' ? 'Бюджет' : 'Стандарт'
    const dims = d.dimStr ?? `${d.width}×${d.height} мм`
    return `Душевая перегородка ${dims} — ${tier}`
  }
  return c.product_type
}

function buildLaunchPayload(c: Calc): LaunchOrderPayload {
  const costLines = (c.cost_breakdown?.lines ?? []) as { name: string; qty: number; unit: string; price?: number; total: number }[]
  const svcLines  = (c.financial_breakdown?.serviceLines ?? []) as { name: string; qty?: number; unit?: string; total: number }[]
  const totalCost = (c.cost_breakdown?.totalCost as number) ?? 0

  return {
    product_type:    c.product_type,
    product_name:    getProductName(c),
    dimensions_text: getDescription(c),
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

function findSettingsForCalc(c: Calc, allSettings: FinancialSettings[]): FinancialSettings | null {
  const pt = c.product_type
  return (
    allSettings.find(s => s.product_type === pt) ??
    allSettings.find(s => (pt === 'shower_budget' ? s.tier === 'budget' : s.tier === 'standard')) ??
    allSettings[0] ??
    null
  )
}

export default function CalculationsClient({ isAdmin, usersMap, allSettings }: Props) {
  const [calcs, setCalcs] = useState<Calc[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'mirror' | 'loft' | 'shower'>('all')
  const [launchCalc, setLaunchCalc] = useState<Calc | null>(null)
  const [duplicating, setDuplicating] = useState<number | null>(null)

  useEffect(() => { fetchCalcs() }, [])

  async function fetchCalcs() {
    const supabase = createClient()
    const { data } = await supabase
      .from('calculations')
      .select('id,created_at,created_by,product_type,input_data,cost_breakdown,financial_breakdown,base_price,discount,partner_percent,final_price,margin,profit,manager_bonus,status,client_text')
      .order('created_at', { ascending: false })
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

  async function duplicateCalc(c: Calc) {
    setDuplicating(c.id)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const { data } = await supabase
      .from('calculations')
      .insert({
        product_type:        c.product_type,
        input_data:          c.input_data,
        cost_breakdown:      c.cost_breakdown,
        financial_breakdown: c.financial_breakdown,
        base_price:          c.base_price,
        discount:            c.discount,
        partner_percent:     c.partner_percent,
        final_price:         c.final_price,
        margin:              c.margin,
        profit:              c.profit,
        manager_bonus:       c.manager_bonus,
        client_text:         c.client_text,
        created_by:          session?.user.id ?? null,
        status:              'draft',
      })
      .select('id,created_at,created_by,product_type,input_data,cost_breakdown,financial_breakdown,base_price,discount,partner_percent,final_price,margin,profit,manager_bonus,status,client_text')
      .single()
    if (data) setCalcs(prev => [data as Calc, ...prev])
    setDuplicating(null)
  }

  const filtered = filter === 'all'
    ? calcs
    : calcs.filter(c =>
        filter === 'shower'
          ? c.product_type === 'shower' || c.product_type === 'shower_standard' || c.product_type === 'shower_budget'
          : c.product_type === filter
      )

  const launchSettings = launchCalc ? findSettingsForCalc(launchCalc, allSettings) : null
  const launchPayload  = launchCalc ? buildLaunchPayload(launchCalc) : null

  return (
    <div className="min-h-screen bg-[#f5f5f3]">
      <div className="max-w-5xl mx-auto px-4 py-5">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[18px] font-bold text-[#111110]">История расчётов</h1>
          <div className="flex gap-1.5">
            <Link href="/calculator/mirror" className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#e4e4e0] bg-white text-[#4b4b47] hover:bg-[#fafaf9]">
              + Зеркало
            </Link>
            <Link href="/calculator/loft" className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#e4e4e0] bg-white text-[#4b4b47] hover:bg-[#fafaf9]">
              + Лофт
            </Link>
            <Link href="/calculator/shower" className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#e4e4e0] bg-white text-[#4b4b47] hover:bg-[#fafaf9]">
              + Душевая
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-1.5 mb-4">
          {([
            { k: 'all' as const,    l: 'Все' },
            { k: 'mirror' as const, l: 'Зеркала' },
            { k: 'loft' as const,   l: 'Лофт' },
            { k: 'shower' as const, l: 'Душевые' },
          ]).map(f => {
            const cnt = f.k === 'all' ? calcs.length
              : f.k === 'shower' ? calcs.filter(c => c.product_type === 'shower' || c.product_type === 'shower_standard' || c.product_type === 'shower_budget').length
              : calcs.filter(c => c.product_type === f.k).length
            return (
              <button key={f.k} onClick={() => setFilter(f.k)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === f.k ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#fafaf9]'}`}>
                {f.l} ({cnt})
              </button>
            )
          })}
        </div>

        {/* Cards */}
        {loading ? (
          <div className="py-12 text-center text-[#9a9a95] text-sm">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-[#9a9a95] text-sm">Расчётов пока нет</div>
        ) : (
          <div className="space-y-2">
            {filtered.map(c => {
              const prodLabel = PRODUCT_LABELS[c.product_type] ?? { label: c.product_type, color: 'bg-gray-100 text-gray-600' }
              const desc      = getDescription(c)
              const totalCost = (c.cost_breakdown?.totalCost as number) ?? 0
              const status    = computeMarginStatus(c.margin, allSettings[0] ?? { default_margin: 40, min_margin: 25 })
              const marginColor =
                status === 'green'   ? 'text-emerald-600' :
                status === 'yellow'  ? 'text-amber-600'   :
                status === 'red'     ? 'text-red-600'     : 'text-red-700'
              const marginBadge =
                status === 'green'   ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                status === 'yellow'  ? 'bg-amber-50 text-amber-700 border-amber-200'       :
                status === 'red'     ? 'bg-red-50 text-red-700 border-red-200'             :
                                       'bg-neutral-100 text-neutral-700 border-neutral-300'
              const managerName = c.created_by ? (usersMap[c.created_by] ?? '—') : '—'
              const st = STATUS_LABELS[c.status] ?? STATUS_LABELS.draft

              return (
                <div key={c.id} className="bg-white rounded-xl border border-[#e4e4e0] p-4">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-[11px] font-mono text-[#c4c4be]">#{c.id}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${prodLabel.color}`}>
                        {prodLabel.label}
                      </span>
                      {desc && <span className="text-[13px] text-[#111110] font-medium truncate">{desc}</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 text-[11px] text-[#9a9a95]">
                      {isAdmin && <span>{managerName}</span>}
                      <span>{new Date(c.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
                      <select value={c.status} onChange={e => updateStatus(c.id, e.target.value)}
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer ${st.color}`}>
                        {Object.entries(STATUS_LABELS).map(([val, { label }]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Financials row */}
                  <div className="flex items-center gap-4 mb-3">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-[#9a9a95]">Цена</span>
                      <span className="text-[14px] font-bold font-mono text-[#111110]">{fmt(c.final_price)}</span>
                    </div>
                    {totalCost > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-[#9a9a95]">Себест.</span>
                        <span className="text-[12px] font-mono text-[#6b6b66]">{fmt(totalCost)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[13px] font-bold ${marginColor}`}>{c.margin.toFixed(1)}%</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${marginBadge}`}>
                        {MARGIN_STATUS_LABELS[status]}
                      </span>
                    </div>
                    {c.profit > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] text-[#9a9a95]">Прибыль</span>
                        <span className="text-[12px] font-mono text-emerald-600">+{fmt(c.profit)}</span>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
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
                    <button onClick={() => deleteCalc(c.id)}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-red-100 text-red-500 hover:bg-red-50 transition-colors">
                      Удалить
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => setLaunchCalc(c)}
                      className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors">
                      Запустить заказ →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <LaunchOrderModal
        isOpen={!!launchCalc}
        onClose={() => setLaunchCalc(null)}
        payload={launchPayload}
        settings={launchSettings}
      />
    </div>
  )
}
