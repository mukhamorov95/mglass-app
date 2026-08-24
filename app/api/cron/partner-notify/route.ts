import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { reconcileClientOrders } from '@/lib/partnerNotify'

export const maxDuration = 60

// Пуш-уведомления партнёрам о смене статуса заказов (принят в работу / готов / отгружен).
// Идёт по всем привязанным к учётке клиентам, сверяет свежие заказы, шлёт e-mail на
// НОВЫЕ транзиции (дедуп в partner_notifications). Гоняется по расписанию (vercel.json).
// Guard: Bearer CRON_SECRET (путь /api/cron/* в middleware не требует сессии).

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const svc = createServiceClient()
  const { data: clients } = await svc
    .from('b2b_clients')
    .select('id,name,user_id')
    .not('user_id', 'is', null)
  let scanned = 0
  for (const c of clients ?? []) {
    await reconcileClientOrders(svc, c as { id: number; name: string; user_id: string | null }).catch(() => {})
    scanned++
  }
  return NextResponse.json({ ok: true, clients: scanned })
}
