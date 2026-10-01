import { NextRequest, NextResponse } from 'next/server'
import { isOwnerRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { summarizeEarnings, type EarningRow } from '@/lib/measure/money'
import { addDays, mskDate, mskToIso } from '@/lib/measure/slots'
import { DATE_RE, loadMeasurers, requireMeasureActor } from '@/lib/measure/server'

export const dynamic = 'force-dynamic'

// Потолок выборки: упрись — итоги неполные, и экран обязан это сказать (truncated).
const LIMIT = 2000
const COLS = 'id, deal_number, client_name, address, scheduled_at, status, measurer_id, measurer_name, manager_name, visit_price, actual_price, price_note, visit_payment, payer, measurer_fee, fee_status, fee_paid_at, result_note'

// «Заработок» замерщика за период: выполненные замеры по дате замера (МСК), итоги
// считает lib/measure/money.ts. Service-role — после requireMeasureActor: замерщик
// получает только свои строки (фильтр в запросе), владелец — любого или всех.
export async function GET(req: NextRequest) {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor
  const owner = isOwnerRole(actor.role)
  if (actor.role !== 'measurer' && !owner) {
    return NextResponse.json({ error: 'Заработок видят сам замерщик и владелец' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const today = mskDate(new Date())
  const from = DATE_RE.test(sp.get('from') ?? '') ? sp.get('from')! : `${today.slice(0, 7)}-01`
  const to = DATE_RE.test(sp.get('to') ?? '') ? sp.get('to')! : today
  if (from > to) return NextResponse.json({ error: 'Начало периода позже конца' }, { status: 400 })
  const measurerId = actor.role === 'measurer' ? actor.userId : (sp.get('measurer_id') || null)

  const svc = createServiceClient()
  let q = svc.from('measure_requests').select(COLS)
    .eq('status', 'done')
    .gte('scheduled_at', mskToIso(from, '00:00'))
    .lt('scheduled_at', mskToIso(addDays(to, 1), '00:00'))
    .order('scheduled_at', { ascending: false })
    .limit(LIMIT)
  if (measurerId) q = q.eq('measurer_id', measurerId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: `Замеры не загрузились: ${error.message}` }, { status: 500 })

  try {
    const rows = (data ?? []) as unknown as EarningRow[]
    return NextResponse.json({
      from, to, measurerId, canPickMeasurer: owner, truncated: rows.length >= LIMIT,
      measurers: owner ? (await loadMeasurers(svc)).map(m => ({ id: m.id, name: m.name })) : [],
      summary: summarizeEarnings(rows),
      rows,
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
