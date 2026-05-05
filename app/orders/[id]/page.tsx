import { getRole } from '@/lib/getRole'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import OrderDetailClient from './OrderDetailClient'
import type { Order, OrderLine } from '@/lib/types'

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const role    = await getRole()
  const isAdmin = role === 'admin'

  const client = isAdmin
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      )
    : await createServerClient()

  const [{ data: order }, { data: lines }, { data: managerRow }] = await Promise.all([
    client.from('orders').select('*').eq('id', id).single(),
    client.from('order_lines').select('*').eq('order_id', id).order('position_num'),
    isAdmin
      ? client.from('users').select('name,email').eq('id',
          (await client.from('orders').select('manager_id').eq('id', id).single()).data?.manager_id ?? ''
        ).single()
      : Promise.resolve({ data: null }),
  ])

  if (!order) notFound()

  const managerName = (managerRow as { name?: string; email?: string } | null)?.name
    ?? (managerRow as { name?: string; email?: string } | null)?.email
    ?? null

  return (
    <OrderDetailClient
      order={order as Order}
      lines={(lines ?? []) as OrderLine[]}
      isAdmin={isAdmin}
      managerName={managerName}
    />
  )
}
