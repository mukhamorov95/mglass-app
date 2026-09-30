import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireMeasureActor, targetMeasurer, TIME_RE } from '@/lib/measure/server'

export const dynamic = 'force-dynamic'

// Рабочие дни и часы замерщика. Service-role — после requireMeasureActor + targetMeasurer.
export async function PUT(req: NextRequest) {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor
  const b = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!b) return NextResponse.json({ error: 'Пустой запрос' }, { status: 400 })

  const svc = createServiceClient()
  const m = await targetMeasurer(svc, actor, b.measurer_id)
  if (m instanceof NextResponse) return m

  const days = Array.isArray(b.work_days) ? [...new Set(b.work_days.map(Number))].filter(d => Number.isInteger(d) && d >= 1 && d <= 7).sort() : []
  const from = String(b.work_from ?? '')
  const to = String(b.work_to ?? '')
  if (!days.length) return NextResponse.json({ error: 'Отметь хотя бы один рабочий день' }, { status: 400 })
  if (!TIME_RE.test(from) || !TIME_RE.test(to) || from >= to) {
    return NextResponse.json({ error: 'Часы работы: «с» раньше «до», формат ЧЧ:ММ' }, { status: 400 })
  }

  const { error } = await svc.from('measurer_schedules').upsert({
    user_id: m.id, work_days: days, work_from: from, work_to: to,
    updated_at: new Date().toISOString(), updated_by: actor.userId,
  }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: `Не сохранено: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true, schedule: { work_days: days, work_from: from, work_to: to } })
}
