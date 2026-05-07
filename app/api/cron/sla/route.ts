import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Get SLA settings (use first row with defaults)
  const { data: settings } = await supabase
    .from('financial_settings')
    .select('sla_days_approved, sla_days_in_work')
    .limit(1)
    .single()

  const slaApproved = (settings as any)?.sla_days_approved ?? 7
  const slaInWork   = (settings as any)?.sla_days_in_work   ?? 21

  const now = new Date()
  const approvedCutoff = new Date(now.getTime() - slaApproved * 86_400_000).toISOString()
  const inWorkCutoff   = new Date(now.getTime() - slaInWork   * 86_400_000).toISOString()

  const { data: stuckOrders } = await supabase
    .from('orders')
    .select('id, number, client_name, status, approved_at, launched_at, total_sale_price')
    .or(
      `and(status.eq.approved,approved_at.lt.${approvedCutoff}),` +
      `and(status.eq.in_work,launched_at.lt.${inWorkCutoff})`,
    )

  if (!stuckOrders?.length) {
    return NextResponse.json({ ok: true, alerts: 0 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mglass-app.vercel.app'

  const lines = stuckOrders.map(o => {
    const since = o.status === 'approved'
      ? Math.floor((now.getTime() - new Date(o.approved_at).getTime()) / 86_400_000)
      : Math.floor((now.getTime() - new Date(o.launched_at).getTime()) / 86_400_000)
    const statusLabel = o.status === 'approved' ? 'Одобрен' : 'В работе'
    return `• <a href="${appUrl}/orders/${o.id}">${o.number}</a> — ${o.client_name} [${statusLabel} ${since} дн.]`
  })

  const msg = [
    `⏱ <b>SLA-предупреждение: ${stuckOrders.length} заказ(ов) завис(ли)</b>`,
    '',
    ...lines,
    '',
    `Одобренные ждут >  ${slaApproved} дн., в работе > ${slaInWork} дн.`,
  ].join('\n')

  await notifyAdmins(msg)

  return NextResponse.json({ ok: true, alerts: stuckOrders.length })
}
