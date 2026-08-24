import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase-service'

// Веб-очередь задач владельца (owner_tasks) + статус воркера (owner_task_workers).
// Раньше очередь была видна только через CLI `node scripts/owner-tasks.mjs`.
// Доступ гейтит app/admin/layout.tsx (owner-роли). Read-only.

export const dynamic = 'force-dynamic'

type Task = {
  id: number; title: string | null; raw_text: string | null; details: string | null
  category: string | null; priority: string | null; status: string
  result_note: string | null; claimed_by: string | null
  created_at: string; updated_at: string | null
}
type Worker = { worker_id: string; machine: string | null; last_seen: string }

const PRIO_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 }
const fmt = (s: string | null) => s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
// Date.now() вынесен из тела компонента (react-покомпонентная чистота); тут — обычная функция.
function workerAlive(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < 10 * 60 * 1000
}

function TaskCard({ t }: { t: Task }) {
  const prioColor = t.priority === 'high' ? 'bg-red-100 text-red-700' : t.priority === 'low' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-[14px] text-[#111110]">{t.title || t.raw_text || `Задача #${t.id}`}</div>
        {t.priority && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${prioColor}`}>{t.priority}</span>}
      </div>
      {t.details && <div className="text-[12px] text-[#6b6b66] mt-1 whitespace-pre-wrap">{t.details}</div>}
      <div className="text-[11px] text-[#9a9a95] mt-1.5 flex flex-wrap gap-x-3">
        <span>#{t.id}</span>
        {t.category && <span>{t.category}</span>}
        <span>создана {fmt(t.created_at)}</span>
        {t.claimed_by && <span>воркер: {t.claimed_by}</span>}
      </div>
      {t.result_note && <div className="text-[12px] text-emerald-700 mt-1.5 border-t border-[#f0f0ec] pt-1.5">✓ {t.result_note}</div>}
    </div>
  )
}

export default async function OwnerTasksPage() {
  const svc = createServiceClient()
  const [{ data: tasksRaw }, { data: workersRaw }] = await Promise.all([
    svc.from('owner_tasks').select('*').order('created_at', { ascending: false }).limit(200),
    svc.from('owner_task_workers').select('*').order('last_seen', { ascending: false }),
  ])
  const tasks = (tasksRaw ?? []) as Task[]
  const workers = (workersRaw ?? []) as Worker[]

  const latest = workers[0]
  const alive = workerAlive(latest?.last_seen)

  const queued = tasks.filter(t => t.status === 'queued').sort((a, b) => (PRIO_ORDER[a.priority ?? 'normal'] ?? 1) - (PRIO_ORDER[b.priority ?? 'normal'] ?? 1))
  const inProgress = tasks.filter(t => t.status === 'in_progress')
  const done = tasks.filter(t => t.status === 'done').slice(0, 30)

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Задачи владельца</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">Очередь из Telegram-бота (owner_tasks). Раньше была видна только из терминала.</p>
          </div>
          <div className={`text-[13px] px-3 py-1.5 rounded-lg font-medium ${alive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {alive ? '🟢 Воркер активен' : '⚪️ Воркер не запущен'}
            {latest && <span className="text-[11px] opacity-70"> · {latest.machine ?? latest.worker_id} · {fmt(latest.last_seen)}</span>}
          </div>
        </div>
      </div>

      <div className="px-5 pt-4 max-w-[820px] space-y-6">
        {!alive && queued.length > 0 && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700">
            Воркер не активен, а в очереди {queued.length} задач(и) — они не выполняются. Запустите воркер: <code className="text-[12px]">node scripts/owner-tasks.mjs heartbeat</code>
          </div>
        )}

        <section>
          <h2 className="text-[12px] font-semibold text-[#8a8a85] uppercase tracking-wide mb-2">В очереди · {queued.length}</h2>
          <div className="space-y-2">
            {queued.length ? queued.map(t => <TaskCard key={t.id} t={t} />) : <p className="text-[13px] text-[#c4c4be]">Очередь пуста</p>}
          </div>
        </section>

        {inProgress.length > 0 && (
          <section>
            <h2 className="text-[12px] font-semibold text-[#8a8a85] uppercase tracking-wide mb-2">В работе · {inProgress.length}</h2>
            <div className="space-y-2">{inProgress.map(t => <TaskCard key={t.id} t={t} />)}</div>
          </section>
        )}

        <section>
          <h2 className="text-[12px] font-semibold text-[#8a8a85] uppercase tracking-wide mb-2">Выполнено (последние {done.length})</h2>
          <div className="space-y-2 opacity-75">
            {done.length ? done.map(t => <TaskCard key={t.id} t={t} />) : <p className="text-[13px] text-[#c4c4be]">Пока пусто</p>}
          </div>
        </section>

        <Link href="/admin/owner" className="inline-block text-[12px] text-[#6b6b66] hover:text-[#111110]">← В админ-хаб</Link>
      </div>
    </div>
  )
}
