import { NextRequest, NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { COST_KEYS, COST_RU, loadMarginMonths, periodTotals } from '@/lib/sales/marginBook'
import { factVars } from '@/lib/breakeven'
import { shiftMonth } from '@/lib/sales/period'
import { mskDayKey } from '@/lib/time'

export const dynamic = 'force-dynamic'

// Факт переменных M-Glass для вкладки «M-Glass · факт «Маржи»» (/cfo/breakeven): доли статей
// книги «Маржа» от продаж закрытых заказов — тем же кодом, что /sales/margin. Наружу —
// только суммы по статьям, без объектов. Service role — после проверки доступа к странице.
export async function GET(req: NextRequest) {
  const guard = await requirePageAccess('/cfo/breakeven')
  if (guard instanceof NextResponse) return guard

  const period = req.nextUrl.searchParams.get('period') === '12m' ? '12m' : 'year'
  // Только полные месяцы: текущий ещё не закрыт и занизил бы средние продажи.
  const last = shiftMonth(mskDayKey().slice(0, 7), -1)
  const first = period === '12m' ? shiftMonth(last, -11) : `${last.slice(0, 4)}-01`
  const months: string[] = []
  for (let m = first; m <= last; m = shiftMonth(m, 1)) months.push(m)

  try {
    const { byMonth, editsError } = await loadMarginMonths(createServiceClient(), months)
    const t = periodTotals(byMonth.flatMap(x => x.objects))
    const labels = Object.fromEntries(COST_KEYS.map(k => [k, COST_RU[k][0].toUpperCase() + COST_RU[k].slice(1)]))
    return NextResponse.json({
      period, from: first, to: last, months: months.length,
      objects: t.objects, closed: t.closed, sales: t.sales, closedSales: t.closed_sales, costs: t.costs,
      avgSales: t.sales / months.length,
      vars: factVars(t.byCost, t.closed_sales, labels),
      editsError,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'книга «Маржа» не прочитана' }, { status: 500 })
  }
}
