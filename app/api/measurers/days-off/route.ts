import { NextRequest, NextResponse } from 'next/server'
import { isOwnerRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDate } from '@/lib/measure/slots'
import { DATE_RE, loadBookings, loadMeasurers, requireMeasureActor, targetMeasurer, text } from '@/lib/measure/server'

export const dynamic = 'force-dynamic'

// Предстоящие выходные и часы: замерщику — свои, владельцу — всех замерщиков.
export async function GET() {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor
  const owner = isOwnerRole(actor.role)
  if (actor.role !== 'measurer' && !owner) {
    return NextResponse.json({ error: 'График замерщика видят сам замерщик и владелец' }, { status: 403 })
  }
  const svc = createServiceClient()
  try {
    const measurers = (await loadMeasurers(svc)).filter(m => owner || m.id === actor.userId)
    let q = svc.from('measurer_days_off').select('id, measurer_id, date_from, date_to, note, created_by_name')
      .gte('date_to', mskDate(new Date())).order('date_from').limit(100)
    if (!owner) q = q.eq('measurer_id', actor.userId)
    const { data, error } = await q
    if (error) throw new Error(`Выходные не загрузились: ${error.message}`)
    return NextResponse.json({ canPickMeasurer: owner, measurers, daysOff: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

// Выходной или отпуск замерщика. Service-role — после requireMeasureActor + targetMeasurer.
// Уже назначенные на эти дни замеры не трогаем, а называем — их надо перенести.
export async function POST(req: NextRequest) {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor
  const b = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!b) return NextResponse.json({ error: 'Пустой запрос' }, { status: 400 })

  const svc = createServiceClient()
  const m = await targetMeasurer(svc, actor, b.measurer_id)
  if (m instanceof NextResponse) return m

  const from = String(b.date_from ?? '')
  const to = String(b.date_to || b.date_from || '')
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return NextResponse.json({ error: 'Даты: «с» не позже «по»' }, { status: 400 })
  }

  const { data, error } = await svc.from('measurer_days_off').insert({
    measurer_id: m.id, date_from: from, date_to: to, note: text(b.note, 300),
    created_by: actor.userId, created_by_name: actor.name,
  }).select('id, measurer_id, date_from, date_to, note').single()
  if (error) return NextResponse.json({ error: `Не сохранено: ${error.message}` }, { status: 500 })

  try {
    const clash = (await loadBookings(svc, from, to, m.id)).filter(x => x.status === 'scheduled')
    return NextResponse.json({ ok: true, dayOff: data, clashes: clash.map(x => ({ id: x.id, scheduled_at: x.scheduled_at, address: x.address })) })
  } catch {
    return NextResponse.json({ ok: true, dayOff: data, clashes: [] })
  }
}

export async function DELETE(req: NextRequest) {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 })

  const svc = createServiceClient()
  const { data: row, error: readErr } = await svc.from('measurer_days_off').select('id, measurer_id').eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 })
  if (!isOwnerRole(actor.role) && row.measurer_id !== actor.userId) {
    return NextResponse.json({ error: 'Убрать выходной может сам замерщик или владелец' }, { status: 403 })
  }
  const { data, error } = await svc.from('measurer_days_off').delete().eq('id', id).select('id')
  if (error) return NextResponse.json({ error: `Не удалено: ${error.message}` }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Не удалено' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
