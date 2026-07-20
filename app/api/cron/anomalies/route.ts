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
  type SettingsRow = { min_margin: number | null; max_discount_percent: number | null; product_type: string | null }
  const defaultSettings = ((settings ?? []) as SettingsRow[]).find(s => !s.product_type) ?? { min_margin: 25, max_discount_percent: 15 }
  const minMargin   = defaultSettings.min_margin        ?? 25
  const maxDiscount = defaultSettings.max_discount_percent ?? 15

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

  type OrderRow = { id: string; number: string; margin_percent: number; status: string }
  type LineRow  = { order_id: string; discount_percent: number; product_name: string }
  const orderRows = (orders ?? []) as OrderRow[]
  const lineRows  = (lines ?? []) as LineRow[]

  // Check order-level margin
  for (const o of orderRows) {
    if (o.margin_percent < minMargin && o.status !== 'pending_approval') {
      anomalies.push(
        `⚠ Низкая маржа <a href="${appUrl}/orders/${o.id}">${o.number}</a>: ${o.margin_percent?.toFixed(1)}% (мин. ${minMargin}%)`,
      )
    }
  }

  // Check line-level discounts
  for (const l of lineRows) {
    if (l.discount_percent > maxDiscount) {
      const order = orderRows.find(o => o.id === l.order_id)
      const orderRef = order ? `<a href="${appUrl}/orders/${order.id}">${order.number}</a>` : 'неизв.'
      anomalies.push(
        `💸 Скидка ${l.discount_percent}% на «${l.product_name}» (заказ ${orderRef}), макс. ${maxDiscount}%`,
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
