import 'server-only'
import { NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { isOwnerRole } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'

// Маршруты карточки розничного заказа (/orders/[id]) пишут service-ключом. До 08.10
// их пускала одна сессия: любой вошедший — партнёр, цех — менял доставку, бригаду и
// этапы чужого заказа. Теперь: роль с доступом к карточке, а не владелец — только
// заказ, который он видит под своим RLS, как сама страница карточки.
export async function requireOrderAccess(orderId: string): Promise<NextResponse | null> {
  const role = await requirePageAccess('/orders')
  if (role instanceof NextResponse) return role
  if (isOwnerRole(role)) return null
  const sb = await createClient()
  const { data, error } = await sb.from('orders').select('id').eq('id', orderId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Заказ не найден или недоступен' }, { status: 404 })
  return null
}
