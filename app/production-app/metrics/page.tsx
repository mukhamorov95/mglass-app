'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { PRODUCTION_STAGES } from '@/lib/productionStages'
import { PROD_SINCE, deadlineOf } from '@/lib/orderFlags'
import ProductionTabs from '@/components/ProductionTabs'

// Метрики цеха: выработка по станциям, скорость (цикл/ожидание), журнал проблем.
// Всё из production_tasks: started_at/completed_at/problem_*.

type Task = {
  id: number
  order_id: number
  stage_key: string
  station: string
  status: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  problem_reason_code: string | null
  problem_comment: string | null
  problem_at: string | null
  problem_resolved_at: string | null
}

const hours = (ms: number) => ms / 3600000
const fmtDur = (ms: number | null) => {
  if (ms == null || !isFinite(ms) || ms <= 0) return '—'
  const h = hours(ms)
  if (h < 1) return `${Math.round(h * 60)} мин`
  if (h < 48) return `${h.toFixed(1)} ч`
  return `${(h / 24).toFixed(1)} дн`
}
const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

export default function MetricsPage() {
  const sb = createClient()
  const [tasks, setTasks] = useState<Task[]>([])
  // Срок отгрузки по заказам производственного контура (только с deadline_date)
  const [deadlines, setDeadlines] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<7 | 30>(7)
  const [nowTs, setNowTs] = useState(0)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNowTs(Date.now())
  }, [])

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 35 * 86400000).toISOString()
      const [{ data }, { data: ords }] = await Promise.all([
        sb.from('production_tasks')
          .select('id, order_id, stage_key, station, status, created_at, started_at, completed_at, problem_reason_code, problem_comment, problem_at, problem_resolved_at')
          .gte('created_at', since).limit(5000),
        sb.from('b2b_orders').select('id,notes')
          .gte('created_at', PROD_SINCE)
          .is('archived_at', null)
          .not('notes', 'ilike', '%"status":"quote"%')
          .not('notes', 'ilike', '%"historical":true%'),
      ])
      setTasks((data ?? []) as Task[])
      setDeadlines(new Map(((ords ?? []) as { id: number; notes: unknown }[])
        .map(o => [o.id, deadlineOf(o.notes)] as [number, string | null])
        .filter((x): x is [number, string] => x[1] != null)))
      setLoading(false)
    })().catch(() => setLoading(false))
  }, [sb])

  const stats = useMemo(() => {
    const from = nowTs - period * 86400000
    const done = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).getTime() >= from)
    const byStation = PRODUCTION_STAGES.map(s => {
      const st = done.filter(t => t.stage_key === s.key)
      const cycles = st.filter(t => t.started_at).map(t => new Date(t.completed_at!).getTime() - new Date(t.started_at!).getTime()).filter(x => x > 0)
      const leads = st.map(t => new Date(t.completed_at!).getTime() - new Date(t.created_at).getTime()).filter(x => x > 0)
      return { key: s.key, label: s.label, count: st.length, cycle: avg(cycles), lead: avg(leads) }
    })
    const activeProblems = tasks.filter(t => t.status === 'problem' && !t.problem_resolved_at)
    const problemLog = tasks.filter(t => t.problem_at)
      .sort((a, b) => (b.problem_at ?? '').localeCompare(a.problem_at ?? '')).slice(0, 20)
    const wip = tasks.filter(t => t.status === 'in_progress').length

    // Отгрузка в срок: заказ «упакован» = все его packaging-задачи done,
    // дата факта = последняя completed_at; сравниваем день-к-дню с deadline_date
    let onTime = 0, late = 0, overdueNow = 0
    const day = (s: string) => s.slice(0, 10)
    const todayStr = new Date(from + period * 86400000).toISOString().slice(0, 10)
    for (const [orderId, deadline] of deadlines) {
      const pack = tasks.filter(t => t.order_id === orderId && t.stage_key === 'packaging')
      if (!pack.length) continue
      const allDone = pack.every(t => t.status === 'done' && t.completed_at)
      if (allDone) {
        const packedAt = pack.map(t => t.completed_at!).sort().at(-1)!
        if (new Date(packedAt).getTime() < from) continue // упакован раньше периода
        if (day(packedAt) <= deadline) onTime++; else late++
      } else if (deadline < todayStr) {
        overdueNow++
      }
    }
    const shipped = onTime + late
    return { done: done.length, byStation, activeProblems, problemLog, wip, onTime, shipped, overdueNow }
  }, [tasks, deadlines, period, nowTs])

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-3">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Метрики цеха</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Выработка, скорость и проблемы по станциям. Цикл — от «взял» до «готово»; ожидание+работа — от создания задачи до готовности.</p>
        <ProductionTabs />
      </div>

      <div className="px-5 pt-4 space-y-4 max-w-[1100px]">
        <div className="flex items-center gap-2">
          {[7, 30].map(p => (
            <button key={p} onClick={() => setPeriod(p as 7 | 30)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium ${period === p ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66]'}`}>
              {p} дней
            </button>
          ))}
          <span className="text-[12px] text-[#9a9a95] ml-2">выполнено задач: <b className="text-[#111110]">{stats.done}</b> · сейчас в работе: <b className="text-[#111110]">{stats.wip}</b></span>
        </div>

        {/* Отгрузка в срок — главная клиентская метрика цеха */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Отгрузка в срок · за {period} дней</p>
          <div className="flex items-baseline gap-3 mt-1 flex-wrap">
            {stats.shipped > 0 ? (
              <>
                <span className={`text-[24px] font-bold ${stats.onTime / stats.shipped >= 0.9 ? 'text-emerald-700' : stats.onTime / stats.shipped >= 0.7 ? 'text-amber-600' : 'text-red-600'}`}>
                  {Math.round(stats.onTime / stats.shipped * 100)}%
                </span>
                <span className="text-[13px] text-[#6b6b66]">{stats.onTime} из {stats.shipped} упакованы не позже срока</span>
              </>
            ) : (
              <span className="text-[13px] text-[#9a9a95]">Пока нет упакованных заказов со сроком за период</span>
            )}
            {stats.overdueNow > 0 && (
              <span className="text-[13px] font-semibold text-red-600">⚠️ сейчас просрочено и не упаковано: {stats.overdueNow}</span>
            )}
          </div>
          <p className="mt-1 text-[10px] text-[#c4c4be]">Считаются заказы контура с датой отгрузки; факт = день, когда упакована последняя деталь.</p>
        </div>

        {/* По станциям */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
          <p className="px-4 pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest text-[#9a9a95]">Станции за {period} дней</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-[#9a9a95] border-b border-[#f0f0ec]">
                  <th className="px-4 py-2">Станция</th>
                  <th className="px-2 py-2 text-right">Выполнено</th>
                  <th className="px-2 py-2 text-right">Средний цикл (работа)</th>
                  <th className="px-4 py-2 text-right">Ожидание + работа</th>
                </tr>
              </thead>
              <tbody>
                {stats.byStation.map(s => (
                  <tr key={s.key} className="border-b border-[#f8f8f7]">
                    <td className="px-4 py-2 font-medium">{s.label}</td>
                    <td className="px-2 py-2 text-right font-mono font-bold">{s.count || '—'}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmtDur(s.cycle)}</td>
                    <td className="px-4 py-2 text-right font-mono text-[#6b6b66]">{fmtDur(s.lead)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[10px] text-[#c4c4be]">Большое «ожидание+работа» при коротком цикле = задачи долго лежат в очереди — узкое место перед станцией.</p>
        </div>

        {/* Активные проблемы */}
        <div className={`rounded-xl border p-4 ${stats.activeProblems.length ? 'bg-red-50 border-red-200' : 'bg-white border-[#e4e4e0]'}`}>
          <p className={`text-[11px] font-bold uppercase tracking-widest ${stats.activeProblems.length ? 'text-red-700' : 'text-[#9a9a95]'}`}>
            ⚠️ Активные проблемы · {stats.activeProblems.length}
          </p>
          {stats.activeProblems.length === 0 ? (
            <p className="text-[12px] text-[#c4c4be] mt-1">Нет — цех работает штатно.</p>
          ) : (
            <div className="mt-2 space-y-1">
              {stats.activeProblems.map(t => (
                <p key={t.id} className="text-[12px] text-red-700">
                  Заказ #{t.order_id} · {t.station} · {t.problem_reason_code || 'причина не указана'}{t.problem_comment ? ` — ${t.problem_comment}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Журнал проблем */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#9a9a95] mb-2">Журнал проблем (последние 20)</p>
          {stats.problemLog.length === 0 ? (
            <p className="text-[12px] text-[#c4c4be]">Проблем не фиксировалось.</p>
          ) : (
            <div className="space-y-1">
              {stats.problemLog.map(t => (
                <p key={t.id} className="text-[12px] text-[#6b6b66]">
                  <span className="font-mono">{t.problem_at ? new Date(t.problem_at).toLocaleDateString('ru-RU') : ''}</span>
                  {' '}· заказ #{t.order_id} · {t.station} · {t.problem_reason_code || '—'}
                  {t.problem_comment ? ` — ${t.problem_comment}` : ''}
                  {t.problem_resolved_at ? ' · ✅ решено' : ' · 🔴 открыто'}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
