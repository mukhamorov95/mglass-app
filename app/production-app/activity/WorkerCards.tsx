import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase-service'
import { errorText, readIn, readPaged } from '@/lib/production/paged'
import { stageLabel } from '@/lib/productionStages'
import { mskDayKey, mskTime } from '@/lib/time'
import { plural } from '@/lib/morning'
import { addDays, ddmm, periodLabel, PRESETS, weekday, type Period, type Resolved } from '@/lib/sales/periodSales'
import { summarizeWorker, type StageCount, type WorkerMark } from '@/lib/production/workerActivity'

// По каждому работнику: что отмечено за период (владелец 03.11.2026). Показывается только
// владельцу, а сам экран открыт всему цеху как общая картина смены: ряд с нулём у коллеги — не для общей доски.
// У блока своя загрузка и своя ошибка: сбой здесь не должен читаться как «отметок нет».

type Row = WorkerMark & { completed_by: string }
type OrderRow = { id: number; custom_number: string | null; client_name: string | null }
type Last = { id: string; markAt: string | null; seenDay: string | null }

async function loadWorkers(ids: string[], period: Period) {
  const svc = createServiceClient()
  const rows = await readPaged<Row>((a, b) => svc.from('production_tasks')
    .select('completed_by, completed_at, stage_key, order_id, auto_closed')
    .in('completed_by', ids)
    .gte('completed_at', `${period.from}T00:00:00+03:00`)
    .lt('completed_at', `${addDays(period.to, 1)}T00:00:00+03:00`)
    .order('id').range(a, b))
  const orderIds = [...new Set(rows.filter(r => !r.auto_closed).map(r => r.order_id))]
  const orders = await readIn<OrderRow, number>(orderIds, (part, a, b) => svc.from('b2b_orders')
    .select('id, custom_number, client_name').in('id', part).order('id').range(a, b))
  const last = await Promise.all(ids.map(async (id): Promise<Last> => {
    const [mark, seen] = await Promise.all([
      svc.from('production_tasks').select('completed_at').eq('completed_by', id)
        .not('completed_at', 'is', null).not('auto_closed', 'is', true)
        .order('completed_at', { ascending: false }).limit(1).maybeSingle(),
      svc.from('user_activity_days').select('day').eq('user_id', id)
        .order('day', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (mark.error) throw new Error(mark.error.message)
    if (seen.error) throw new Error(seen.error.message)
    return { id, markAt: (mark.data?.completed_at as string | undefined) ?? null, seenDay: (seen.data?.day as string | undefined) ?? null }
  }))
  return { rows, orders, last }
}

function Chips({ stages }: { stages: StageCount[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {stages.map(s => (
        <span key={s.key} className="text-[11px] text-[#6b6b66] bg-[#f5f5f3] border border-[#e4e4e0] rounded-md px-2 py-0.5">
          {stageLabel(s.key)} · <span className="font-mono font-semibold">{s.n}</span>
        </span>
      ))}
    </span>
  )
}

export default async function WorkerCards({ crew, resolved, path }: {
  crew: { user_id: string; name: string | null }[]
  resolved: Resolved
  path: string
}) {
  const { preset, period } = resolved
  let data: Awaited<ReturnType<typeof loadWorkers>> | null = null
  let failure: string | null = null
  try {
    data = await loadWorkers(crew.map(c => c.user_id), period)
  } catch (e) {
    failure = errorText(e)
  }

  const orderById = new Map((data?.orders ?? []).map(o => [o.id, o]))
  const lastById = new Map((data?.last ?? []).map(l => [l.id, l]))
  const cards = crew.map(c => ({
    ...c,
    s: summarizeWorker((data?.rows ?? []).filter(r => r.completed_by === c.user_id)),
    last: lastById.get(c.user_id),
  })).sort((a, b) => b.s.marks - a.s.marks || (b.last?.markAt ?? '').localeCompare(a.last?.markAt ?? '') || (a.name ?? '').localeCompare(b.name ?? ''))

  return (
    <div id="workers" className="space-y-3 scroll-mt-4">
      <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
        <p className="text-[15px] font-semibold text-[#111110]">По работникам · {periodLabel(period)}</p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <div className="flex flex-wrap bg-[#f0f0ec] rounded-lg p-0.5">
            {PRESETS.map(x => (
              <Link key={x.id} href={`${path}?p=${x.id}#workers`}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium ${preset === x.id ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66] hover:text-[#111110]'}`}>
                {x.label}
              </Link>
            ))}
          </div>
          <form method="get" action={`${path}#workers`} className={`flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 ${preset === 'range' ? 'bg-white border border-[#111110]' : 'bg-[#f0f0ec]'}`}>
            <span className="text-[12px] text-[#6b6b66]">Период: с</span>
            <input type="date" name="from" defaultValue={period.from} required className="text-[12px] bg-white border border-[#e4e4e0] rounded px-1.5 py-1" />
            <span className="text-[12px] text-[#6b6b66]">по</span>
            <input type="date" name="to" defaultValue={period.to} required className="text-[12px] bg-white border border-[#e4e4e0] rounded px-1.5 py-1" />
            <button type="submit" className="text-[12px] font-medium bg-[#111110] text-white rounded px-2.5 py-1">Показать</button>
          </form>
        </div>
        <p className="text-[11px] text-[#9a9a95] mt-2 max-w-[70ch]">
          Отметка — это нажатие «Готово», а не сама работа: цех часто отмечает позже или пачкой. Поэтому время
          у дня показывает, когда нажимали, а ноль отметок не значит, что человек не работал.
        </p>
      </div>

      {failure && (
        <p className="text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          Не удалось загрузить отметки по работникам: {failure}. Обновите страницу.
        </p>
      )}

      {!failure && cards.map(c => {
        const { s, last } = c
        return (
          <div key={c.user_id} id={`w-${c.user_id}`} className="bg-white border border-[#e4e4e0] rounded-xl p-4 scroll-mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-[15px] font-semibold text-[#111110]">{c.name ?? '—'}</p>
              {s.marks > 0 ? (
                <p className="text-[13px] text-[#6b6b66] tabular-nums">
                  <span className="text-[17px] font-bold text-[#111110]">{s.marks}</span> {plural(s.marks, 'отметка', 'отметки', 'отметок')}
                  {' · '}{s.orders} {plural(s.orders, 'заказ', 'заказа', 'заказов')}
                  {' · '}{s.days.length} {plural(s.days.length, 'день', 'дня', 'дней')}
                </p>
              ) : (
                <p className="text-[13px] text-[#9a9a95]">за этот период отметок нет</p>
              )}
            </div>

            {s.stages.length > 0 && <div className="mt-2"><Chips stages={s.stages} /></div>}

            <p className="text-[11px] text-[#9a9a95] mt-2 tabular-nums">
              {last?.markAt ? `Последняя отметка — ${ddmm(mskDayKey(last.markAt))}` : 'Отметок ещё не было'}
              {' · '}
              {last?.seenDay ? `в приложении последний раз — ${ddmm(last.seenDay)}` : 'заходов в приложение нет'}
              {s.autoMarks > 0 && ` · ещё ${s.autoMarks} закрыто автоматически под этим именем, в счёт не входят`}
            </p>

            {s.days.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[12px] font-medium text-[#111110] select-none">По дням и заказам</summary>
                <div className="mt-2">
                  {s.days.map(d => (
                    <details key={d.day} className="border-t border-[#f5f5f3] py-1.5">
                      <summary className="cursor-pointer text-[12.5px] select-none">
                        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 align-middle">
                          <span className="font-medium text-[#111110] tabular-nums">{ddmm(d.day)} {weekday(d.day)}</span>
                          <span className="font-mono font-semibold text-[#111110]">{d.total}</span>
                          <span className="font-mono text-[11px] text-[#9a9a95]">{mskTime(d.firstAt)}–{mskTime(d.lastAt)}</span>
                          <Chips stages={d.stages} />
                        </span>
                      </summary>
                      <ul className="mt-1.5 ml-4 space-y-1">
                        {d.orders.map(o => {
                          const ord = orderById.get(o.orderId)
                          return (
                            <li key={o.orderId} className="text-[12px] text-[#6b6b66]">
                              <Link href={`/production-app/orders/${o.orderId}`} className="font-medium text-[#111110] underline decoration-[#d4d4ce] underline-offset-2">
                                {ord?.custom_number?.trim() || `#${o.orderId}`}
                              </Link>
                              {ord?.client_name ? ` · ${ord.client_name}` : ''}
                              {' — '}{o.stages.map(x => `${stageLabel(x.key)} ${x.n}`).join(', ')}
                            </li>
                          )
                        })}
                      </ul>
                    </details>
                  ))}
                </div>
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}
