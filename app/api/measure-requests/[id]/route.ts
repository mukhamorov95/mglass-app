import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { ALLOWED_FROM, denyAction, type MeasureAction } from '@/lib/measure/access'
import { REQ_COLS, requireMeasureActor, text, tryBook, type MeasureRequestRow } from '@/lib/measure/server'

export const dynamic = 'force-dynamic'

const STATUS_RU: Record<string, string> = {
  new: 'ждёт замерщика', scheduled: 'назначен', done: 'выполнен', issue: 'сложность', cancelled: 'отменён',
}
const ACTIONS = new Set<MeasureAction>(['schedule', 'unassign', 'done', 'issue', 'cancel', 'reopen', 'fee_paid'])

// Действие над заявкой. Service-role — после requireMeasureActor + denyAction;
// запись с замком по updated_at: если заявку изменили между чтением и записью
// (два замерщика взяли одну), второй получает 409, а не молча перезаписывает.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor
  const id = Number((await params).id)
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const b = await req.json().catch(() => null) as Record<string, unknown> | null
  const action = b?.action as MeasureAction
  if (!b || !ACTIONS.has(action)) return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })

  const svc = createServiceClient()
  const { data: rowRaw, error: readErr } = await svc.from('measure_requests').select(REQ_COLS).eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: `Заявка не прочитана: ${readErr.message}` }, { status: 500 })
  if (!rowRaw) return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 })
  const row = rowRaw as unknown as MeasureRequestRow

  const deny = denyAction(actor, row, action)
  if (deny) return NextResponse.json({ error: deny }, { status: 403 })
  if (!ALLOWED_FROM[action as Exclude<MeasureAction, 'attach'>].includes(row.status)) {
    return NextResponse.json({ error: `Заявка сейчас «${STATUS_RU[row.status] ?? row.status}» — это действие недоступно` }, { status: 409 })
  }

  const now = new Date().toISOString()
  let patch: Record<string, unknown>
  switch (action) {
    case 'schedule': {
      const measurerId = actor.role === 'measurer' ? actor.userId : String(b.measurer_id ?? '')
      if (actor.role === 'measurer' && b.measurer_id && b.measurer_id !== actor.userId) {
        return NextResponse.json({ error: 'Замерщик назначает только себя' }, { status: 403 })
      }
      if (!measurerId) return NextResponse.json({ error: 'Выбери замерщика' }, { status: 400 })
      const ok = await tryBook(svc, {
        requestId: row.id, measurerId, date: b.date, time: b.time,
        durationMin: b.duration_min ?? row.duration_min, travelMin: b.travel_min, force: b.force,
      })
      if (ok instanceof NextResponse) return ok
      patch = { status: 'scheduled', measurer_id: ok.measurer.id, measurer_name: ok.measurer.name, scheduled_at: ok.startIso, duration_min: ok.durationMin, travel_min: ok.travelMin }
      break
    }
    case 'unassign':
    case 'reopen':
      patch = { status: 'new', measurer_id: null, measurer_name: null, scheduled_at: null }
      break
    case 'done':
      patch = { status: 'done' }
      break
    case 'issue': {
      const issue = text(b.issue_text, 1000)
      if (!issue) return NextResponse.json({ error: 'Опиши сложность' }, { status: 400 })
      patch = { status: 'issue', issue_text: issue, issue_solution: text(b.issue_solution, 1000) }
      break
    }
    case 'cancel':
      patch = { status: 'cancelled' }
      break
    case 'fee_paid':
      patch = { fee_status: 'paid', fee_paid_at: now }
      break
    default:
      return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  }

  const { data, error } = await svc.from('measure_requests')
    .update({ ...patch, updated_at: now })
    .eq('id', id).eq('updated_at', row.updated_at)
    .select(REQ_COLS)
  if (error) return NextResponse.json({ error: `Не сохранено: ${error.message}` }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Заявку только что изменил кто-то другой — обнови страницу' }, { status: 409 })
  return NextResponse.json({ ok: true, request: data[0] })
}
