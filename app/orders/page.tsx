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

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  // «Видит все сделки»: владелец (admin/ceo) или менеджер с can_view_all_deals.
  // RLS на orders режет по manager_id, поэтому при галке читаем сервис-клиентом
  // (иначе менеджер с расширенным доступом всё равно видел бы только свои).
  let canViewAll = isAdmin || role === 'ceo'
  if (!canViewAll && user?.id) {
    const { data: profile } = await supabase.from('users').select('can_view_all_deals').eq('id', user.id).maybeSingle()
    canViewAll = profile?.can_view_all_deals === true
  }

  if (canViewAll) {
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
    const { data } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
    orders = (data ?? []) as Order[]
  }

  return <OrdersClient orders={orders} isAdmin={isAdmin} usersMap={usersMap} />
}
