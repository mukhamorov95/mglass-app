import { NextRequest, NextResponse } from 'next/server'
import { isOwnerRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { addDays, mskDate, mskMinutes } from '@/lib/measure/slots'
import { DATE_RE, loadBookings, loadDaysOff, loadMeasurers, requireMeasureActor } from '@/lib/measure/server'

export const dynamic = 'force-dynamic'

// Доска занятости замерщиков: кто, когда и где занят, выходные, часы.
// Service-role — после requireMeasureActor. Менеджер (круг own) у чужих заявок
// видит только время, замерщика и адрес — клиент, телефон и что мерить уходят
// лишь по своим. Причина выходного — владельцу и самому замерщику.
export async function GET(req: NextRequest) {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor

  const now = new Date()
  const today = mskDate(now)
  const fromParam = req.nextUrl.searchParams.get('from')
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : today
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 7, 1), 42) // 42 — сетка месяца по неделям
  const to = addDays(from, days - 1)

  const svc = createServiceClient()
  try {
    const [measurers, daysOff, bookings, pool] = await Promise.all([
      loadMeasurers(svc),
      loadDaysOff(svc, from, to),
      loadBookings(svc, from, to),
      svc.from('measure_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    ])
    if (pool.error) throw new Error(`Пул не посчитан: ${pool.error.message}`)

    const owner = isOwnerRole(actor.role)
    const full = actor.scope !== 'own'
    return NextResponse.json({
      me: { id: actor.userId, name: actor.name, role: actor.role, scope: actor.scope, canCreate: actor.canCreate },
      from, to, today, nowMin: mskMinutes(now),
      poolCount: pool.count ?? 0,
      measurers,
      daysOff: daysOff.map(d => ({ ...d, note: owner || d.measurer_id === actor.userId ? d.note : null })),
      bookings: bookings.map(b => {
        const mine = b.manager_id === actor.userId || b.measurer_id === actor.userId
        const open = full || mine
        return {
          id: b.id, measurer_id: b.measurer_id, measurer_name: b.measurer_name,
          scheduled_at: b.scheduled_at, duration_min: b.duration_min, travel_min: b.travel_min, status: b.status,
          address: b.address, mine,
          deal_number: open ? b.deal_number : null,
          client_name: open ? b.client_name : null,
          scope: open ? b.scope : null,
          manager_name: open ? b.manager_name : null,
        }
      }),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
