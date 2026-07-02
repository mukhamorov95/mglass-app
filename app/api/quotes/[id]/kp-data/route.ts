import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { isOwnerRole } from '@/lib/getRole'

// Данные для печатной КП с серверной проверкой доступа (как в pdf-роуте).
// Раньше страница /b2b-quotes/[id]/kp читала b2b_orders напрямую анон-ключом без
// проверки владельца — любой залогиненный мог открыть чужое КП по id.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orderId = Number(id)
  if (!orderId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: order, error } = await sb
    .from('b2b_orders')
    .select('id,client_id,client_name,custom_number,client_order_number,discount_percent,items,total_area,total_weight,total_sale_inc_vat,total_after_discount,notes,created_at,created_by')
    .eq('id', orderId)
    .single()
  if (error || !order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: profile } = await sb.from('users').select('role,see_all_orders').eq('id', user.id).maybeSingle()
  const canAccess =
    isOwnerRole(profile?.role) ||
    (profile?.see_all_orders ?? false) ||
    order.created_by === user.id ||
    order.created_by === null ||
    (order.client_id != null &&
      (await sb.from('b2b_clients').select('id').eq('id', order.client_id).eq('user_id', user.id).maybeSingle()).data != null)
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  return NextResponse.json({ order })
}
