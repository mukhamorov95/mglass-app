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

  // Fetch financial thresholds
  const { data: settings } = await supabase
    .from('financial_settings')
    .select('min_margin, max_discount_percent, product_type')

  // Build threshold map by product_type (null = default)
  const defaultSettings = (settings ?? []).find((s: any) => !s.product_type) ?? { min_margin: 25, max_discount_percent: 15 }
  const minMargin   = (defaultSettings as any).min_margin        ?? 25
  const maxDiscount = (defaultSettings as any).max_discount_percent ?? 15

  // Orders in the last 24h that violate thresholds
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: orders } = await supabase
    .from('orders')
    .select('id, number, client_name, margin_percent, status, created_at')
    .gte('created_at', since)
    .not('status', 'eq', 'cancelled')

  const { data: lines } = await supabase
    .from('order_lines')
    .select('order_id, discount_percent, margin_percent, product_name')
    .gte('created_at', since)

  const anomalies: string[] = []
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mglass-app.vercel.app'

  // Check order-level margin
  for (const o of (orders ?? [])) {
    if ((o as any).margin_percent < minMargin && (o as any).status !== 'pending_approval') {
      anomalies.push(
        `⚠ Низкая маржа <a href="${appUrl}/orders/${(o as any).id}">${(o as any).number}</a>: ${(o as any).margin_percent?.toFixed(1)}% (мин. ${minMargin}%)`,
      )
    }
  }

  // Check line-level discounts
  for (const l of (lines ?? [])) {
    if ((l as any).discount_percent > maxDiscount) {
      const order = (orders ?? []).find((o: any) => o.id === (l as any).order_id)
      const orderRef = order ? `<a href="${appUrl}/orders/${order.id}">${(order as any).number}</a>` : 'неизв.'
      anomalies.push(
        `💸 Скидка ${(l as any).discount_percent}% на «${(l as any).product_name}» (заказ ${orderRef}), макс. ${maxDiscount}%`,
      )
    }
  }

  if (!anomalies.length) return NextResponse.json({ ok: true, anomalies: 0 })

  const msg = [
    `🚨 <b>Аномалии за последние 24ч</b>`,
    '',
    ...anomalies,
  ].join('\n')

  await notifyAdmins(msg)

  return NextResponse.json({ ok: true, anomalies: anomalies.length })
}
