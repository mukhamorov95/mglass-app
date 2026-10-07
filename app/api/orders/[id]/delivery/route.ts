import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireOrderAccess } from '@/lib/orders/orderAccess'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await params
  const denied = await requireOrderAccess(id)
  if (denied) return denied
  const { delivery_address, delivery_zone_id, delivery_cost } = await req.json()

  const client = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const update: Record<string, unknown> = {
    delivery_address: delivery_address?.trim() || null,
  }
  if (delivery_zone_id !== undefined) update.delivery_zone_id = delivery_zone_id || null
  if (delivery_cost    !== undefined) update.delivery_cost    = Number(delivery_cost) || 0

  const { error } = await client.from('orders').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
