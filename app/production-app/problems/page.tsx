'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-browser'
import { STAGE_LABELS, type DetailStageKey } from '@/lib/productionStages'
import { ANDON_REASON_LABELS } from '@/lib/productionRouting'
import { PROD_SINCE } from '@/lib/orderFlags'
import { effectiveItemTotal, type B2BOrderItem } from '@/lib/b2bCalculator'
import { materialLabel } from '@/lib/materialLabel'
import { useCanViewMoney } from '@/lib/useCanViewMoney'

// «Проблемы» — одна доска на всех: мастер видит свою проблему, цех видит общую
// картину, владелец — сумму зависших изделий. Ничего не удаляем: решённая
// проблема переезжает во вторую колонку вместе с тем, кто и чем её закрыл.

type ProblemRow = {
  id: number
  order_id: number
  item_index: number
  stage_key: string
  status: string
  problem_reason_code: string | null
  problem_comment: string | null
  problem_at: string
  problem_resolved_at: string | null
  problem_by_name: string | null
  problem_resolved_by_name: string | null
  problem_resolution: string | null
}
type OrderLite = {
  id: number
  custom_number: string | null
  client_name: string | null
  items?: Partial<B2BOrderItem>[]
  discount_percent?: number | null
}
type Period = 'week' | 'month' | 'all'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week',  label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'all',   label: 'Всё' },
]

// Сумма — довод, зачем чинить проблему, но это выручка: показываем только тем,
// у кого есть доступ к деньгам (как на вкладке «Деньги»). Остальным — прочерк.
const RUB_RAW = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const rub = (n: number, can: boolean | null) => can ? RUB_RAW(n) : '—'
const orderNo = (o: OrderLite | undefined, id: number) => o?.custom_number?.trim() || `#${id}`

const fmtDateTime = (s: string | null) => {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function specLine(item?: Partial<B2BOrderItem>): string {
  if (!item) return ''
  const dims = item.width && item.height ? `${item.width}×${item.height}` : ''
  const qty = item.quantity && item.quantity > 1 ? `${item.quantity} шт` : ''
  return [dims, materialLabel(item), qty].filter(Boolean).join(' · ')
}

function itemValue(o: OrderLite | undefined, idx: number): number {
  const it = o?.items?.[idx]
  if (!it) return 0
  const v = effectiveItemTotal(it as B2BOrderItem, o?.discount_percent ?? 0)
  return Number.isFinite(v) ? v : 0
}

export default function ProblemsPage() {
  const sb = createClient()
  const canMoney = useCanViewMoney()
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<ProblemRow[]>([])
  const [orders, setOrders] = useState<Map<number, OrderLite>>(new Map())
  const [period, setPeriod] = useState<Period>('month')
  const [resolveFor, setResolveFor] = useState<number | null>(null)
  const [resolveText, setResolveText] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: rows } = await sb.from('production_tasks')
      .select('id,order_id,item_index,stage_key,status,problem_reason_code,problem_comment,problem_at,problem_resolved_at,problem_by_name,problem_resolved_by_name,problem_resolution')
      .not('problem_at', 'is', null)
      .order('problem_at', { ascending: false })

    const list = (rows ?? []) as ProblemRow[]
    const orderIds = [...new Set(list.map(t => t.order_id))]
    const { data: orderRows } = orderIds.length
      ? await sb.from('b2b_orders').select('id,custom_number,client_name,items,discount_percent').in('id', orderIds).gte('created_at', PROD_SINCE)
      : { data: [] as OrderLite[] }

    // Производственный контур — только заказы с PROD_SINCE
    const map = new Map<number, OrderLite>(((orderRows ?? []) as OrderLite[]).map(o => [o.id, o]))
    setOrders(map)
    setTasks(list.filter(t => map.has(t.order_id)))
    setLoading(false)
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  async function submitResolve(taskId: number) {
    setSaving(true)
    await fetch(`/api/production-tasks/${taskId}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: resolveText.trim() || null }),
    }).catch(() => {})
    setResolveFor(null)
    setResolveText('')
    setSaving(false)
    load()
  }

  const days = period === 'week' ? 7 : period === 'month' ? 30 : null
  const since = days == null ? null : new Date().getTime() - days * 86400000
  const inPeriod = (s: string | null) => {
    if (since == null) return true
    if (!s) return false
    const t = new Date(s).getTime()
    return !isNaN(t) && t >= since
  }

  const openTasks = tasks.filter(t => !t.problem_resolved_at && inPeriod(t.problem_at))
  const doneTasks = tasks.filter(t => t.problem_resolved_at && inPeriod(t.problem_resolved_at))
    .sort((a, b) => (b.problem_resolved_at ?? '').localeCompare(a.problem_resolved_at ?? ''))
  const openEarlier = tasks.filter(t => !t.problem_resolved_at && !inPeriod(t.problem_at)).length

  // Одна стекляшка = до 8 задач по этапам. Считаем деньги по ДЕТАЛИ, иначе
  // сумма зависших изделий раздувается в разы.
  const sumDeduped = (rows: ProblemRow[]) => {
    const seen = new Set<string>()
    return rows.reduce((s, t) => {
      const k = `${t.order_id}:${t.item_index}`
      if (seen.has(k)) return s
      seen.add(k)
      return s + itemValue(orders.get(t.order_id), t.item_index)
    }, 0)
  }

  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">⚠️ Проблемы</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Видно всему цеху и владельцу. Проблема не удаляется — она закрывается решением.</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 max-w-[1100px]">
        <div className="flex gap-1.5 mb-3">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${period === p.key ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">Открытых проблем</p>
            <p className={`text-[22px] font-bold mt-0.5 ${openTasks.length > 0 ? 'text-red-600' : 'text-[#111110]'}`}>{openTasks.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">На сумму</p>
            <p className="text-[22px] font-bold font-mono text-[#111110] mt-0.5">{rub(sumDeduped(openTasks), canMoney)}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">Решено за период</p>
            <p className="text-[22px] font-bold text-emerald-700 mt-0.5">{doneTasks.length}</p>
          </div>
        </div>

        {openEarlier > 0 && (
          <button onClick={() => setPeriod('all')}
            className="mb-4 text-[12px] text-[#6b6b66] underline underline-offset-2">
            Ещё {openEarlier} открытых проблем раньше периода — показать все
          </button>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-2 text-red-700">Не решены · {openTasks.length}</p>
            <div className="space-y-2">
              {openTasks.length === 0 && (
                <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center">
                  <p className="text-[13px] text-[#9a9a95]">Открытых проблем нет</p>
                </div>
              )}
              {openTasks.map(t => (
                <ProblemCard key={t.id} task={t} order={orders.get(t.order_id)} value={itemValue(orders.get(t.order_id), t.item_index)} canMoney={canMoney}>
                  {resolveFor === t.id ? (
                    <div className="mt-2 space-y-1.5">
                      <input value={resolveText} onChange={e => setResolveText(e.target.value)} autoFocus
                        placeholder="Что сделали, чтобы закрыть проблему"
                        className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
                      <div className="flex gap-1.5">
                        <button onClick={() => { setResolveFor(null); setResolveText('') }}
                          className="flex-1 py-2 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#6b6b66]">Отмена</button>
                        <button onClick={() => submitResolve(t.id)} disabled={saving}
                          className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-medium disabled:opacity-60">
                          {saving ? 'Сохраняем…' : 'Сохранить'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setResolveFor(t.id); setResolveText('') }}
                      className="mt-2 px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-medium">
                      ✅ Решено
                    </button>
                  )}
                </ProblemCard>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-2 text-emerald-700">Решены · {doneTasks.length}</p>
            <div className="space-y-2">
              {doneTasks.length === 0 && (
                <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center">
                  <p className="text-[13px] text-[#9a9a95]">За период ничего не закрыто</p>
                </div>
              )}
              {doneTasks.map(t => (
                <ProblemCard key={t.id} task={t} order={orders.get(t.order_id)} value={itemValue(orders.get(t.order_id), t.item_index)} canMoney={canMoney} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProblemCard({ task, order, value, canMoney, children }: {
  task: ProblemRow
  order: OrderLite | undefined
  value: number
  canMoney: boolean | null
  children?: React.ReactNode
}) {
  const resolved = !!task.problem_resolved_at
  const spec = specLine(order?.items?.[task.item_index]) || `Поз. ${task.item_index + 1}`
  const stage = STAGE_LABELS[task.stage_key as DetailStageKey] ?? task.stage_key
  const reason = ANDON_REASON_LABELS[task.problem_reason_code ?? ''] ?? task.problem_reason_code ?? 'Проблема'

  return (
    <div className={`rounded-xl border bg-white px-4 py-3 ${resolved ? 'border-[#e4e4e0]' : 'border-red-300'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-[#111110] truncate">{orderNo(order, task.order_id)}</p>
          <p className="text-[12px] text-[#6b6b66] truncate">{order?.client_name}</p>
        </div>
        <p className="text-[13px] font-mono font-semibold text-[#111110] flex-shrink-0">{rub(value, canMoney)}</p>
      </div>

      <p className="text-[12px] font-mono text-[#111110] mt-2">{spec}</p>
      <p className="text-[11px] text-[#9a9a95]">Поз. {task.item_index + 1} · {stage}</p>

      <p className={`text-[13px] font-semibold mt-2 ${resolved ? 'text-[#6b6b66]' : 'text-red-700'}`}>{reason}</p>
      {task.problem_comment && <p className="text-[12px] text-[#111110] mt-0.5 whitespace-pre-wrap">{task.problem_comment}</p>}

      <p className="text-[11px] text-[#9a9a95] mt-1.5">
        {task.problem_by_name ? `${task.problem_by_name} · ` : ''}{fmtDateTime(task.problem_at)}
      </p>

      {resolved && (
        <div className="mt-2 pt-2 border-t border-[#f0f0ee]">
          <p className="text-[12px] text-emerald-700 font-medium">✅ Решено{task.problem_resolution ? `: ${task.problem_resolution}` : ''}</p>
          <p className="text-[11px] text-[#9a9a95] mt-0.5">
            {task.problem_resolved_by_name ? `${task.problem_resolved_by_name} · ` : ''}{fmtDateTime(task.problem_resolved_at)}
          </p>
        </div>
      )}

      {children}

      <Link href={`/p/o/${task.order_id}`} className="inline-block mt-2 text-[12px] text-[#9a9a95] underline underline-offset-2">
        Открыть карточку заказа →
      </Link>
    </div>
  )
}
