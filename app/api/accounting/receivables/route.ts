import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { RECEIVABLES_ROLES } from '@/lib/money/roles'
import { loadReceivables } from '@/lib/money/receivablesLoad'

export const dynamic = 'force-dynamic'

// Долг клиентов одной функцией (lib/money/receivables) — для /ceo, /cfo/receivables и
// прогноза кассы. Только суммы заказов и оплат: себестоимость и маржа сюда не входят.

export async function GET() {
  const guard = await requireRole([...RECEIVABLES_ROLES])
  if (guard instanceof NextResponse) return guard
  try {
    const rec = await loadReceivables(createServiceClient())
    return NextResponse.json(rec, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: `Долг не посчитался: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
