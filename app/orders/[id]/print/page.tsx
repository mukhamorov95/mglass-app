import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { getRole } from '@/lib/getRole'
import { notFound } from 'next/navigation'
import type { Order, OrderLine } from '@/lib/types'
import PrintClient from './PrintClient'

export default async function PrintPage({
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

  const [{ data: order }, { data: lines }] = await Promise.all([
    client.from('orders').select('*').eq('id', id).single(),
    client.from('order_lines').select('*').eq('order_id', id).order('position_num'),
  ])

  if (!order) notFound()

  return (
    <PrintClient
      order={order as Order}
      lines={(lines ?? []) as OrderLine[]}
      isAdmin={isAdmin}
    />
  )
}
