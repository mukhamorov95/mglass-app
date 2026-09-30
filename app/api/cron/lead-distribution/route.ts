import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { runDistribution } from '@/lib/leadDistribution/collect'

// Распределитель новых заявок «Продаж» (docs/LEAD_DISTRIBUTION_ROUTE.md), каждые 5 минут. Крон не
// авторизован middleware — проверяет свой секрет сам. Тумблер владельца —
// owner_strategy.lead_distribution_mode: off — ничего; иначе тень: решение и причина в
// lead_distribution, в amo ничего не пишется (запись — этап Р2, после недели тени). ?dry=1 — посчитать
// без записи в журнал.
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  try {
    const sb = createServiceClient()
    const { data: mode, error } = await sb.from('owner_strategy').select('value').eq('key', 'lead_distribution_mode').maybeSingle()
    if (error) throw new Error(`Не прочитать тумблер: ${error.message}`)
    if ((mode as { value?: string } | null)?.value === 'off') return NextResponse.json({ ok: true, mode: 'off' })

    const dry = new URL(req.url).searchParams.get('dry') === '1'
    const run = await runDistribution(sb, undefined, !dry)
    return NextResponse.json({
      ok: true, mode: 'shadow', dry, pending: run.pending,
      decisions: run.decisions.map(d => ({
        leadId: d.leadId,
        status: d.decision.status,
        to: d.decision.status === 'decided' ? d.decision.name : null,
        reason: d.decision.reason,
      })),
    })
  } catch (e) {
    console.error('[cron/lead-distribution]', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
