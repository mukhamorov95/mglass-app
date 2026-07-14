import { createClient } from '@/lib/supabase-server'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import { type DetailStages, calcOrderProgress, STAGE_LABELS, type DetailStageKey, PRODUCTION_STAGES } from '@/lib/productionStages'
import { PROD_SINCE } from '@/lib/orderFlags'

// Сводка производства — главный экран цеха: заказы сгруппированы по СРОКУ ВЫДАЧИ
// (готовы / просрочено / отдать сегодня-завтра-послезавтра / позже) + готовность.
// Понятно с первого взгляда для начальника, Сергея и Валерии.

type NotesData = {
  status?: string
  launched_at?: string
  production_days?: number
  deadline_date?: string           // явный срок сдачи (приоритетнее расчётного)
  stages?: Partial<Record<string, string | null>>
  detail_stages?: DetailStages
}

type Order = {
  id: number
  client_name: string
  custom_number: string | null
  items: unknown[]
  notes: string | null
  created_at: string
  parsedNotes: NotesData
}

function parseNotes(notes: string | null): NotesData {
  if (!notes) return {}
  try { const p = JSON.parse(notes); if (typeof p === 'object' && p !== null) return p as NotesData } catch {}
  return {}
}

// Срок сдачи: явная дата → (запуск + производств. дни) → (запуск + 7) → (создан + 10).
function getDeadline(pn: NotesData, createdAt: string): Date {
  if (pn.deadline_date) return new Date(pn.deadline_date)
  if (pn.launched_at && pn.production_days) { const d = new Date(pn.launched_at); d.setDate(d.getDate() + pn.production_days); return d }
  if (pn.launched_at) { const d = new Date(pn.launched_at); d.setDate(d.getDate() + 7); return d }
  const d = new Date(createdAt); d.setDate(d.getDate() + 10); return d
}

type ProgressItem = { hasTempering?: boolean; materialName?: string; category?: string; hasHoles?: boolean; shape?: string }

function readiness(order: Order): { label: string; done: number; total: number; hasProblems: boolean; packed: boolean } {
  const p = calcOrderProgress((Array.isArray(order.items) ? order.items : []) as ProgressItem[], order.parsedNotes.detail_stages ?? {})
  // Текущий этап = самый ранний невыполненный применимый этап (по первой позиции — грубо, для ярлыка).
  const ds = order.parsedNotes.detail_stages ?? {}
  let stageLabel = 'Не начат'
  for (const st of PRODUCTION_STAGES) {
    const anyDone = Object.values(ds).some(s => s?.[st.key as DetailStageKey]?.status === 'done')
    if (anyDone) stageLabel = STAGE_LABELS[st.key as DetailStageKey]
  }
  const packed = p.totalItems > 0 && p.packedItems === p.totalItems
  return { label: packed ? 'Готов к выдаче' : (p.completedItems > 0 || stageLabel !== 'Не начат' ? stageLabel : 'Не начат'), done: p.packedItems, total: p.totalItems, hasProblems: p.hasProblems, packed }
}

type BucketKey = 'ready' | 'overdue' | 'today' | 'tomorrow' | 'dayafter' | 'later'
const BUCKETS: { key: BucketKey; label: string; hdr: string; badge: string }[] = [
  { key: 'ready',    label: '✅ Готовы к выдаче', hdr: 'text-emerald-700', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { key: 'overdue',  label: '🔥 Просрочено',      hdr: 'text-red-600',     badge: 'bg-red-50 text-red-600 border-red-200' },
  { key: 'today',    label: '🟠 Отдать сегодня',  hdr: 'text-amber-700',   badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'tomorrow', label: '🟡 Отдать завтра',   hdr: 'text-yellow-700',  badge: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  { key: 'dayafter', label: '🟢 Отдать послезавтра', hdr: 'text-emerald-700', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { key: 'later',    label: '⚪ Позже',           hdr: 'text-[#6b6b66]',   badge: 'bg-[#f0f0ec] text-[#6b6b66] border-[#e4e4e0]' },
]

export default async function ProductionAppPage() {
  const sb = await createClient()
  const { data } = await sb
    .from('b2b_orders')
    .select('id,client_name,custom_number,items,notes,created_at')
    .not('notes', 'ilike', '%"status":"quote"%')
    .is('archived_at', null)
    .gte('created_at', PROD_SINCE)
    .order('created_at', { ascending: false })
    .limit(500)

  const active: Order[] = (data ?? [])
    .map((o: Record<string, unknown>) => ({
      id: o.id as number, client_name: o.client_name as string, custom_number: o.custom_number as string | null,
      items: Array.isArray(o.items) ? o.items : [], notes: o.notes as string | null, created_at: o.created_at as string,
      parsedNotes: parseNotes(o.notes as string | null),
    }))
    .filter(o => !o.parsedNotes.stages?.shipped)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const grouped: Record<BucketKey, { order: Order; rd: ReturnType<typeof readiness>; days: number }[]> =
    { ready: [], overdue: [], today: [], tomorrow: [], dayafter: [], later: [] }

  for (const o of active) {
    const rd = readiness(o)
    const dl = getDeadline(o.parsedNotes, o.created_at); dl.setHours(0, 0, 0, 0)
    const days = Math.round((dl.getTime() - today.getTime()) / 86_400_000)
    let key: BucketKey
    if (rd.packed) key = 'ready'
    else if (days < 0) key = 'overdue'
    else if (days === 0) key = 'today'
    else if (days === 1) key = 'tomorrow'
    else if (days === 2) key = 'dayafter'
    else key = 'later'
    grouped[key].push({ order: o, rd, days })
  }
  for (const k of Object.keys(grouped) as BucketKey[]) grouped[k].sort((a, b) => a.days - b.days)

  const urgent = grouped.overdue.length + grouped.today.length

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Сводка производства</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">{active.length} в работе · {urgent} горят · {grouped.ready.length} готовы к выдаче</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 space-y-5">
        {active.length === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#9a9a95]">Нет активных заказов</p>
          </div>
        )}
        {BUCKETS.map(b => {
          const list = grouped[b.key]
          if (list.length === 0) return null
          return (
            <div key={b.key}>
              <p className={`text-[12px] font-bold uppercase tracking-wide mb-2 ${b.hdr}`}>{b.label} · {list.length}</p>
              <div className="space-y-2">
                {list.map(({ order, rd }) => {
                  const label = order.custom_number?.trim() || `#${order.id}`
                  return (
                    <Link key={order.id} href={`/production-app/orders/${order.id}`}
                      className="block bg-white rounded-xl border border-[#e4e4e0] px-4 py-3 hover:border-[#111110] active:bg-[#f8f8f7] transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-[14px] font-bold text-[#111110] truncate">{label}</p>
                          <p className="text-[12px] text-[#6b6b66] truncate">{order.client_name}</p>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-1 rounded-full border whitespace-nowrap flex-shrink-0 ${b.badge}`}>
                          {rd.label}{rd.hasProblems ? ' · ⚠' : ''}
                        </span>
                      </div>
                      {rd.total > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-[#f0f0ec] rounded-full overflow-hidden">
                            <div className="h-full bg-[#111110] rounded-full" style={{ width: `${(rd.done / rd.total) * 100}%` }} />
                          </div>
                          <span className="text-[11px] text-[#9a9a95] whitespace-nowrap">{rd.done}/{rd.total} уп.</span>
                        </div>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
