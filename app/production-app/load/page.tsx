import ProductionTabs from '@/components/ProductionTabs'
import { createServiceClient } from '@/lib/supabase-service'
import { PRODUCTION_STAGES } from '@/lib/productionStages'
import { addWorkingDays, DEFAULT_WORKING_DAYS } from '@/lib/b2b/deadline'

// А3: тепловая карта загрузки цеха. Строки — этапы, столбцы — СРОЧНОСТЬ по сроку
// отгрузки заказа (production_day у задач не заполнен, поэтому ось — дедлайн из А1).
// Показывает, где копится работа и что горит. Доступ гейтит production-app/layout.

export const dynamic = 'force-dynamic'

type Task = { order_id: number; stage_key: string }
type OrderRow = { id: number; notes: string | null; launched_at: string | null }

function orderDeadlineMs(o: OrderRow): number | null {
  let notes: Record<string, unknown> = {}
  try { notes = o.notes ? JSON.parse(o.notes) : {} } catch {}
  const dd = notes.deadline_date
  if (typeof dd === 'string' && dd) return new Date(dd).getTime()
  // fallback для старых заказов без срока: запуск + 15 рабочих дней
  if (o.launched_at) return addWorkingDays(new Date(o.launched_at), DEFAULT_WORKING_DAYS).getTime()
  return null
}
function bucketOf(deadlineMs: number | null): number {
  if (deadlineMs == null) return 5 // без срока
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const days = Math.floor((deadlineMs - start.getTime()) / 86_400_000)
  if (days < 0) return 0        // просрочено
  if (days === 0) return 1      // сегодня
  if (days <= 3) return 2       // ≤3 дн
  if (days <= 7) return 3       // ≤неделя
  return 4                      // позже
}
function startOfTodayISO(): string { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }
const BUCKETS = ['Просрочено', 'Сегодня', '≤3 дн', '≤неделя', 'Позже', 'Без срока']
const BUCKET_HEAD = ['text-red-700', 'text-orange-600', 'text-amber-600', 'text-[#6b6b66]', 'text-[#9a9a95]', 'text-[#c4c4be]']

function cellBg(n: number, max: number, bucket: number): string {
  if (n === 0) return ''
  if (bucket === 0) return 'bg-red-100 text-red-800'       // просрочено — всегда красным
  const t = max > 0 ? n / max : 0
  if (t > 0.66) return 'bg-blue-200 text-blue-900'
  if (t > 0.33) return 'bg-blue-100 text-blue-800'
  return 'bg-blue-50 text-blue-700'
}

export default async function ProductionLoadPage() {
  const svc = createServiceClient()
  const { data: taskData } = await svc.from('production_tasks')
    .select('order_id, stage_key').neq('status', 'done').limit(20000)
  const tasks = (taskData ?? []) as Task[]
  const orderIds = [...new Set(tasks.map(t => t.order_id))]

  // А5: пропускная способность — сколько задач закрыто СЕГОДНЯ по этапам (поток
  // против очереди). Рабочие идут queued→done без «в работе», поэтому меряем не WIP
  // по людям (трение), а реальный выход по этапу за день.
  const { data: doneData } = await svc.from('production_tasks')
    .select('stage_key').eq('status', 'done').gte('completed_at', startOfTodayISO()).limit(20000)
  const doneToday = new Map<string, number>()
  for (const d of (doneData ?? []) as { stage_key: string }[]) doneToday.set(d.stage_key, (doneToday.get(d.stage_key) ?? 0) + 1)

  const orderDeadline = new Map<number, number | null>()
  for (let i = 0; i < orderIds.length; i += 500) {
    const { data: od } = await svc.from('b2b_orders').select('id, notes, launched_at').in('id', orderIds.slice(i, i + 500))
    for (const o of (od ?? []) as OrderRow[]) orderDeadline.set(o.id, orderDeadlineMs(o))
  }

  // Матрица stage × bucket.
  const stages = PRODUCTION_STAGES.map(s => s.key)
  const grid = new Map<string, number[]>(stages.map(s => [s, [0, 0, 0, 0, 0, 0]]))
  const colTot = [0, 0, 0, 0, 0, 0]
  for (const t of tasks) {
    const b = bucketOf(orderDeadline.get(t.order_id) ?? null)
    const row = grid.get(t.stage_key)
    if (row) { row[b]++; colTot[b]++ }
  }
  const rowTot = new Map<string, number>(stages.map(s => [s, (grid.get(s) ?? []).reduce((a, b) => a + b, 0)]))
  const maxCell = Math.max(1, ...[...grid.values()].flat())
  const totalPending = tasks.length
  const overdue = colTot[0]

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Загрузка цеха</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          {totalPending} задач в работе{overdue > 0 && <> · <span className="text-red-600 font-semibold">{overdue} просрочено</span></>} · по этапам и сроку отгрузки
        </p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4">
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#f0f0ec]">
                <th className="text-left py-2.5 px-3 text-[#9a9a95] font-medium">Этап</th>
                {BUCKETS.map((b, i) => <th key={b} className={`text-center py-2.5 px-2 font-semibold text-[11px] uppercase tracking-wide ${BUCKET_HEAD[i]}`}>{b}</th>)}
                <th className="text-center py-2.5 px-3 text-[#111110] font-semibold">Всего</th>
                <th className="text-center py-2.5 px-3 text-emerald-700 font-semibold border-l border-[#f0f0ec]">✓ Сегодня</th>
              </tr>
            </thead>
            <tbody>
              {PRODUCTION_STAGES.map(s => {
                const row = grid.get(s.key) ?? [0, 0, 0, 0, 0, 0]
                const rt = rowTot.get(s.key) ?? 0
                if (rt === 0) return null
                return (
                  <tr key={s.key} className="border-b border-[#f8f8f7]">
                    <td className="py-2 px-3 font-semibold text-[#111110]">{s.label}</td>
                    {row.map((n, i) => (
                      <td key={i} className="py-1.5 px-1.5 text-center">
                        {n > 0 ? <span className={`inline-block min-w-7 px-2 py-1 rounded-md font-mono font-semibold ${cellBg(n, maxCell, i)}`}>{n}</span> : <span className="text-[#e4e4e0]">·</span>}
                      </td>
                    ))}
                    <td className="py-2 px-3 text-center font-mono font-bold text-[#111110]">{rt}</td>
                    <td className="py-2 px-3 text-center font-mono text-emerald-700 border-l border-[#f8f8f7]">{doneToday.get(s.key) || <span className="text-[#e4e4e0]">·</span>}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#e4e4e0] bg-[#fafaf9] font-semibold">
                <td className="py-2 px-3 text-[#6b6b66] text-[12px]">Итого</td>
                {colTot.map((n, i) => <td key={i} className="py-2 px-1.5 text-center font-mono text-[#111110]">{n || '·'}</td>)}
                <td className="py-2 px-3 text-center font-mono font-bold text-[#111110]">{totalPending}</td>
                <td className="py-2 px-3 text-center font-mono font-bold text-emerald-700 border-l border-[#f0f0ec]">{[...doneToday.values()].reduce((a, b) => a + b, 0) || '·'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-[11px] text-[#9a9a95] mt-2">
          Столбцы — срочность по сроку отгрузки заказа. «Просрочено» — красным. У заказов без явного срока он считается как запуск + 15 рабочих дней.
        </p>
      </div>
    </div>
  )
}
