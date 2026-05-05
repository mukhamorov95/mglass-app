import { getRole } from '@/lib/getRole'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import OrdersClient from './OrdersClient'
import type { Order } from '@/lib/types'

export default async function OrdersPage() {
  const role = await getRole()
  const isAdmin = role === 'admin'

  let orders: Order[] = []
  let usersMap: Record<string, string> = {}

  if (isAdmin) {
    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const [{ data: ordersData }, { data: usersData }] = await Promise.all([
      admin.from('orders').select('*').order('created_at', { ascending: false }),
      admin.from('users').select('id,name,email'),
    ])
    orders = (ordersData ?? []) as Order[]
    usersMap = Object.fromEntries(
      (usersData ?? []).map((u: { id: string; name: string; email: string }) => [u.id, u.name ?? u.email])
    )
  } else {
    const supabase = await createServerClient()
    const { data } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
    orders = (data ?? []) as Order[]
  }

  return <OrdersClient orders={orders} isAdmin={isAdmin} usersMap={usersMap} />
}
