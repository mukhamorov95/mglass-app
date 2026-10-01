import { NextResponse } from 'next/server'
import { isOwnerRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { mskDate, mskToIso } from '@/lib/measure/slots'
import { requireMeasureActor } from '@/lib/measure/server'
import { summarizeOwner, type OwnerRow } from '@/lib/measure/ownerSummary'

export const dynamic = 'force-dynamic'

const LIMIT = 3000

// Сводка собственника по замерам (lib/measure/ownerSummary.ts). Только владелец:
// это все замерщики и все менеджеры сразу. Service-role — после проверки роли.
// В выборку: всё открытое, всё созданное или назначенное в этом месяце и
// выполненные с невыплаченным гонораром (долг компании копится не по месяцам).
export async function GET() {
  const actor = await requireMeasureActor()
  if (actor instanceof NextResponse) return actor
  if (!isOwnerRole(actor.role)) return NextResponse.json({ error: 'Сводку видит владелец' }, { status: 403 })

  const today = mskDate(new Date())
  const start = `"${mskToIso(`${today.slice(0, 7)}-01`, '00:00')}"`
  const svc = createServiceClient()
  const { data, error } = await svc.from('measure_requests')
    .select('id, status, is_repeat, created_at, scheduled_at, visit_payment, fee_status, measurer_fee')
    .or(`status.in.(new,scheduled,issue),created_at.gte.${start},scheduled_at.gte.${start},and(status.eq.done,fee_status.neq.paid)`)
    .limit(LIMIT)
  if (error) return NextResponse.json({ error: `Сводка не загрузилась: ${error.message}` }, { status: 500 })
  const rows = (data ?? []) as OwnerRow[]
  return NextResponse.json({ summary: summarizeOwner(rows, today), truncated: rows.length >= LIMIT })
}
