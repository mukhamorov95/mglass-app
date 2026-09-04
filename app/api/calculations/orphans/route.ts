import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireDealActor } from '@/lib/b2c/dealScope'

export const dynamic = 'force-dynamic'

// Расчёты, которые не привязаны ни к одной сделке. Быстрый расчёт разрешает
// считать «на бегу», без клиента — и такие расчёты растворялись: в воронку не
// попадали, в «Сделках» их не видно, вспомнить о них нечем. Здесь они видимы,
// чтобы менеджер закрыл хвост до конца дня.
export async function GET() {
  const actor = await requireDealActor()
  if (actor instanceof NextResponse) return actor

  const svc = createServiceClient()
  let q = svc.from('calculations')
    .select('id, created_at, product_type, client_name, client_phone, final_price, client_text')
    .is('deal_id', null)
    .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(50)
  if (!actor.seeAll) q = q.eq('created_by', actor.userId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}
