import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { buildMeasureMessage } from '@/lib/measure/message'
import { REQ_COLS, loadMeasurers, money, requireMeasureActor, text, tryBook } from '@/lib/measure/server'

export const dynamic = 'force-dynamic'

// Заявки на замер. Service-role — после requireMeasureActor: круг видимости
// (all / measurer / own) задаёт фильтр запроса, а не фильтр по результату.
export async function GET() {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor
  const svc = createServiceClient()

  let q = svc.from('measure_requests').select(REQ_COLS).order('created_at', { ascending: false }).limit(300)
  if (actor.scope === 'measurer') q = q.or(`status.eq.new,measurer_id.eq.${actor.userId}`)
  else if (actor.scope === 'own') q = q.eq('manager_id', actor.userId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: `Заявки не загрузились: ${error.message}` }, { status: 500 })

  try {
    const measurers = await loadMeasurers(svc)
    return NextResponse.json({
      me: { id: actor.userId, name: actor.name, role: actor.role, scope: actor.scope, canCreate: actor.canCreate },
      requests: data ?? [],
      measurers: measurers.map(m => ({ id: m.id, name: m.name, schedule: m.schedule })),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

// Новая заявка: в пул («замерщик договорится сам») или сразу с замерщиком и
// временем (booking) — тогда та же проверка пересечений, что у «Взять».
export async function POST(req: NextRequest) {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor
  if (!actor.canCreate) return NextResponse.json({ error: 'Заявки на замер создаёт менеджер' }, { status: 403 })

  const b = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!b) return NextResponse.json({ error: 'Пустой запрос' }, { status: 400 })
  const client_name = text(b.client_name, 200)
  const address = text(b.address, 500)
  if (!client_name) return NextResponse.json({ error: 'Укажи имя клиента' }, { status: 400 })
  if (!address) return NextResponse.json({ error: 'Укажи адрес объекта — замерщику некуда ехать без него' }, { status: 400 })

  const visit_price = money(b.visit_price)
  const fields = {
    deal_number: text(b.deal_number, 50),
    client_name,
    phone: text(b.phone, 50),
    amo_url: text(b.amo_url, 500),
    address,
    scope: text(b.scope),
    notes: text(b.notes),
    visit_price,
    payer: text(b.payer, 200),
    is_repeat: b.is_repeat === true,
  }
  const leadId = b.lead_id == null ? null : Number(b.lead_id)
  if (leadId !== null && !Number.isInteger(leadId)) return NextResponse.json({ error: 'Некорректный лид' }, { status: 400 })

  const svc = createServiceClient()
  const booking = b.booking as Record<string, unknown> | null | undefined
  let sched: Record<string, unknown> = { status: 'new' }
  if (booking) {
    const ok = await tryBook(svc, {
      measurerId: String(booking.measurer_id ?? ''), date: booking.date, time: booking.time,
      durationMin: booking.duration_min, travelMin: booking.travel_min, force: booking.force,
    })
    if (ok instanceof NextResponse) return ok
    sched = {
      status: 'scheduled', measurer_id: ok.measurer.id, measurer_name: ok.measurer.name,
      scheduled_at: ok.startIso, duration_min: ok.durationMin, travel_min: ok.travelMin,
    }
  }

  const { data, error } = await svc.from('measure_requests').insert({
    ...fields,
    ...sched,
    lead_id: leadId,
    raw_text: text(b.raw_text, 5000),
    structured_text: buildMeasureMessage({ ...fields, manager_name: actor.name }),
    manager_id: actor.userId,
    manager_name: actor.name,
    // Гонорар замерщика по умолчанию = цена выезда (так форма делала и раньше);
    // явный 0 из карточки лида сохраняется как 0 — решение Р4 маршрута.
    measurer_fee: b.measurer_fee === undefined || b.measurer_fee === '' ? visit_price : money(b.measurer_fee),
  }).select(REQ_COLS).single()
  if (error) return NextResponse.json({ error: `Заявка не создана: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true, request: data })
}
