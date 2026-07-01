import { createClient } from '@/lib/supabase-server'
import { STAGE_LABELS, type DetailStageKey } from '@/lib/productionStages'
import { ANDON_REASON_LABELS } from '@/lib/productionRouting'
import AssignWorker from './AssignWorker'

// Full shop-floor task pool, grouped by station — for the production supervisor.
// v1 simplification: shows everything outstanding right now (queued/in_progress/
// problem), not a strict production_day=today schedule — nothing in the app sets
// production_day automatically yet, and a manual day-assignment step wasn't asked
// for. Not to be confused with the deadline-risk "Производственный день" toggle
// in /b2b-orders, which triages whole ORDERS by deadline, not shop tasks by station.

type TaskRow = {
  id: number
  order_id: number
  item_index: number
  stage_key: string
  station: string
  status: 'queued' | 'in_progress' | 'done' | 'problem'
  assigned_to: string | null
  problem_reason_code: string | null
  problem_comment: string | null
  problem_at: string | null
}

type OrderLite = { id: number; client_name: string; custom_number: string | null }
type WorkerLite = { id: string; name: string | null; email: string | null; production_stations: string[] | null }

const STATIONS: DetailStageKey[] = ['cutting', 'curved', 'polishing', 'drilling', 'tempering', 'packaging']

export default async function ProductionTodayPage() {
  const sb = await createClient()

  const { data: taskRows } = await sb
    .from('production_tasks')
    .select('id,order_id,item_index,stage_key,station,status,assigned_to,problem_reason_code,problem_comment,problem_at')
    .in('status', ['queued', 'in_progress', 'problem'])
    .order('station', { ascending: true })

  const tasks = (taskRows ?? []) as TaskRow[]
  const orderIds  = [...new Set(tasks.map(t => t.order_id))]

  const [{ data: orderRows }, { data: workerRows }] = await Promise.all([
    orderIds.length ? sb.from('b2b_orders').select('id,client_name,custom_number').in('id', orderIds) : Promise.resolve({ data: [] as OrderLite[] }),
    sb.from('users').select('id,name,email,production_stations').eq('role', 'production').eq('active', true),
  ])

  const orders     = new Map((orderRows ?? []).map((o: OrderLite) => [o.id, o]))
  const allWorkers = (workerRows ?? []) as WorkerLite[]

  const problems = tasks.filter(t => t.status === 'problem')
  const byStation = new Map<string, TaskRow[]>()
  for (const t of tasks) {
    if (t.status === 'problem') continue
    const list = byStation.get(t.station) ?? []
    list.push(t)
    byStation.set(t.station, list)
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Пул на сегодня</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">{tasks.length} задач цеха · {problems.length} проблем</p>
      </div>

      {problems.length > 0 && (
        <div className="px-4 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-red-600 mb-3">Активные проблемы</p>
          <div className="space-y-2 mb-6">
            {problems.map(t => {
              const o = orders.get(t.order_id)
              return (
                <div key={t.id} className="bg-red-50 rounded-xl border border-red-200 px-4 py-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-[#111110] truncate">{o?.custom_number?.trim() || `#${t.order_id}`}</p>
                      <p className="text-[12px] text-[#6b6b66] truncate">{o?.client_name}</p>
                    </div>
                    <span className="text-[10px] font-medium px-2 py-1 rounded-full bg-red-100 text-red-700 whitespace-nowrap flex-shrink-0">
                      Поз. {t.item_index + 1} · {STAGE_LABELS[t.stage_key as DetailStageKey] ?? t.stage_key}
                    </span>
                  </div>
                  <p className="text-[12px] text-red-700 font-medium">
                    {t.problem_reason_code ? ANDON_REASON_LABELS[t.problem_reason_code] ?? t.problem_reason_code : 'Проблема'}
                  </p>
                  {t.problem_comment && <p className="text-[12px] text-red-600 mt-0.5">{t.problem_comment}</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="px-4">
        {STATIONS.map(station => {
          const list = byStation.get(station) ?? []
          if (list.length === 0) return null
          return (
            <div key={station} className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-3">
                {STAGE_LABELS[station]} · {list.length}
              </p>
              <div className="space-y-2">
                {list.map(t => {
                  const o = orders.get(t.order_id)
                  return (
                    <div key={t.id} className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold text-[#111110] truncate">{o?.custom_number?.trim() || `#${t.order_id}`}</p>
                        <p className="text-[12px] text-[#6b6b66] truncate">{o?.client_name} · поз. {t.item_index + 1}</p>
                      </div>
                      <AssignWorker taskId={t.id} station={t.station} assignedTo={t.assigned_to} workers={allWorkers} />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {tasks.length === 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-8 text-center">
            <p className="text-[14px] text-[#9a9a95]">Нет задач в производстве</p>
          </div>
        )}
      </div>
    </div>
  )
}
