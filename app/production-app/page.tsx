import { createClient } from '@/lib/supabase-server'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type DetailStageKey = 'cutting' | 'polishing' | 'drilling' | 'tempering' | 'packaging' | 'problem'
type DetailStageState = { status: 'done' | 'problem'; updated_at: string }
type DetailStages = { [itemIndex: string]: { [stage in DetailStageKey]?: DetailStageState } }

type NotesData = {
  status?: string
  launched_at?: string
  production_days?: number
  stages?: Partial<Record<string, string | null>>
  detail_stages?: DetailStages
}

type Order = {
  id: number
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  items: unknown[]
  notes: string | null
  created_at: string
  parsedNotes: NotesData
}

type DeadlineStatus = 'overdue' | 'today' | 'tomorrow' | 'normal' | 'ready' | 'shipped'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNotes(notes: string | null): NotesData {
  if (!notes) return {}
  try {
    const p = JSON.parse(notes)
    if (typeof p === 'object' && p !== null) return p as NotesData
  } catch {}
  return {}
}

function getPlannedDeadline(pn: NotesData, createdAt: string): Date {
  if (pn.launched_at && pn.production_days) {
    const d = new Date(pn.launched_at)
    d.setDate(d.getDate() + pn.production_days)
    return d
  }
  if (pn.launched_at) {
    const d = new Date(pn.launched_at)
    d.setDate(d.getDate() + 7)
    return d
  }
  const d = new Date(createdAt)
  d.setDate(d.getDate() + 10)
  return d
}

function getDeadlineStatus(order: Order): {
  status: DeadlineStatus
  label: string
  daysDiff: number | null
} {
  const pn = order.parsedNotes
  const stages = pn.stages ?? {}
  if (stages.shipped)  return { status: 'shipped',  label: 'Отгружен',  daysDiff: null }
  if (stages.packaged) return { status: 'ready',    label: 'Готов',     daysDiff: null }

  const planned = getPlannedDeadline(pn, order.created_at)
  const today   = new Date(); today.setHours(0, 0, 0, 0)
  const planDay = new Date(planned); planDay.setHours(0, 0, 0, 0)
  const daysDiff = Math.round((planDay.getTime() - today.getTime()) / 86_400_000)

  if (daysDiff < 0)  return { status: 'overdue',  label: `−${Math.abs(daysDiff)} дн.`,  daysDiff }
  if (daysDiff === 0) return { status: 'today',   label: 'Сегодня',                      daysDiff }
  if (daysDiff === 1) return { status: 'tomorrow', label: 'Завтра',                      daysDiff }
  return { status: 'normal', label: `${daysDiff} дн.`, daysDiff }
}

function getProgress(order: Order): { done: number; total: number; hasProblems: boolean } {
  const items = Array.isArray(order.items) ? order.items : []
  const ds    = order.parsedNotes.detail_stages ?? {}
  const total = items.length
  if (total === 0) return { done: 0, total: 0, hasProblems: false }

  let done = 0
  let hasProblems = false
  for (let i = 0; i < total; i++) {
    const s = ds[String(i)]
    if (!s) continue
    if (s.packaging?.status === 'done')   done++
    if (s.problem?.status  === 'problem') hasProblems = true
  }
  return { done, total, hasProblems }
}

const STATUS_ORDER: Record<DeadlineStatus, number> = {
  overdue: 0, today: 1, tomorrow: 2, normal: 3, ready: 4, shipped: 5,
}

const DEADLINE_BADGE: Record<DeadlineStatus, string> = {
  overdue:  'bg-red-50 text-red-600 border-red-200',
  today:    'bg-amber-50 text-amber-700 border-amber-200',
  tomorrow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  normal:   'bg-[#f0f0ec] text-[#6b6b66] border-[#e4e4e0]',
  ready:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  shipped:  'bg-[#f0f0ec] text-[#9a9a95] border-[#e4e4e0]',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ProductionAppPage() {
  const sb = await createClient()

  const { data } = await sb
    .from('b2b_orders')
    .select('id,client_name,custom_number,client_order_number,items,notes,created_at')
    .not('notes', 'ilike', '%"status":"quote"%')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .limit(500)

  const allOrders: Order[] = (data ?? []).map((o: Record<string, unknown>) => ({
    id:                  o.id as number,
    client_name:         o.client_name as string,
    custom_number:       o.custom_number as string | null,
    client_order_number: o.client_order_number as string | null,
    items:               Array.isArray(o.items) ? o.items : [],
    notes:               o.notes as string | null,
    created_at:          o.created_at as string,
    parsedNotes:         parseNotes(o.notes as string | null),
  }))

  const active = allOrders.filter(o => !o.parsedNotes.stages?.shipped)

  const dsMap  = new Map(active.map(o => [o.id, getDeadlineStatus(o)]))
  const pgMap  = new Map(active.map(o => [o.id, getProgress(o)]))

  const counts = {
    tasks:    active.length,
    overdue:  active.filter(o => dsMap.get(o.id)?.status === 'overdue').length,
    problems: active.filter(o => pgMap.get(o.id)?.hasProblems).length,
    ready:    active.filter(o => {
      const p = pgMap.get(o.id)!
      return p.total > 0 && p.done === p.total
    }).length,
  }

  const sorted = [...active].sort((a, b) => {
    const oa = STATUS_ORDER[dsMap.get(a.id)!.status]
    const ob = STATUS_ORDER[dsMap.get(b.id)!.status]
    if (oa !== ob) return oa - ob
    const da = dsMap.get(a.id)!.daysDiff ?? 999
    const db = dsMap.get(b.id)!.daysDiff ?? 999
    return da - db
  })

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">

      {/* Header */}
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Сегодня</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Производство</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 p-4">
        <StatCard label="Активных"  value={counts.tasks}    color="text-[#111110]"    />
        <StatCard label="Просрочено" value={counts.overdue}  color="text-red-600"      />
        <StatCard label="Проблемы"  value={counts.problems} color="text-orange-600"   />
        <StatCard label="Упаковано" value={counts.ready}    color="text-emerald-600"  />
      </div>

      {/* Orders list */}
      <div className="px-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-3">
          Заказы в производстве
        </p>

        {sorted.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#9a9a95]">Нет активных заказов</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map(order => {
              const ds    = dsMap.get(order.id)!
              const prog  = pgMap.get(order.id)!
              const label = order.custom_number?.trim() || `#${order.id}`

              return (
                <Link
                  key={order.id}
                  href={`/production-app/orders/${order.id}`}
                  className="block bg-white rounded-xl border border-[#e4e4e0] px-4 py-3 hover:border-[#111110] active:bg-[#f8f8f7] transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-[#111110] truncate">{label}</p>
                      <p className="text-[12px] text-[#6b6b66] truncate">{order.client_name}</p>
                    </div>
                    <span className={`text-[10px] font-medium px-2 py-1 rounded-full border whitespace-nowrap flex-shrink-0 ${DEADLINE_BADGE[ds.status]}`}>
                      {ds.label}
                    </span>
                  </div>

                  {prog.total > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-[#f0f0ec] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#111110] rounded-full"
                          style={{ width: `${(prog.done / prog.total) * 100}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-[#9a9a95] whitespace-nowrap">
                        {prog.done}/{prog.total} уп.
                      </span>
                      {prog.hasProblems && (
                        <span className="text-[11px] text-red-500 font-bold">!</span>
                      )}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
      <p className="text-[11px] text-[#9a9a95] font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-[32px] font-bold mt-1 leading-none ${color}`}>{value}</p>
    </div>
  )
}
