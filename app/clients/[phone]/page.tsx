import { createClient } from '@/lib/supabase-server'
import Link from 'next/link'
import { getRole } from '@/lib/getRole'
import { redirect, notFound } from 'next/navigation'
import { ORDER_STATUS_LABELS } from '@/lib/types'
import type { OrderStatus } from '@/lib/types'

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

const STATUS_STYLE: Record<OrderStatus, string> = {
  draft:            'bg-gray-100 text-gray-600',
  pending_approval: 'bg-red-100 text-red-700',
  approved:         'bg-amber-100 text-amber-700',
  in_work:          'bg-blue-100 text-blue-700',
  completed:        'bg-emerald-100 text-emerald-700',
  cancelled:        'bg-gray-100 text-gray-400',
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ phone: string }>
}) {
  const supabase = await createClient()
  const role = await getRole()
  if (!role) redirect('/login')

  const { data: { user } } = await supabase.auth.getUser()
  const { phone: encodedKey } = await params
  const key = decodeURIComponent(encodedKey)

  // Match by phone or name
  let ordersQuery = supabase
    .from('orders')
    .select('*')
    .or(`client_phone.eq.${key},client_name.eq.${key}`)
    .order('created_at', { ascending: false })

  if (role !== 'admin') ordersQuery = ordersQuery.eq('manager_id', user!.id)

  const { data: orders } = await ordersQuery
  if (!orders?.length) notFound()

  // Fetch calculations matching client phone/name
  const { data: calcs } = await supabase
    .from('calculations')
    .select('id, product_type, final_price, margin, status, created_at, client_text')
    .order('created_at', { ascending: false })
    .limit(20)

  const client = orders[0]
  const totalRevenue = orders
    .filter(o => o.status !== 'cancelled')
    .reduce((s, o) => s + o.total_sale_price, 0)

  const activeOrders = orders.filter(o => ['in_work', 'approved', 'pending_approval'].includes(o.status))

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-6">

        <div className="flex items-center gap-2 text-[13px] mb-5">
          <Link href="/clients" className="text-[#9a9a95] hover:text-[#6b6b66]">← Клиенты</Link>
          <span className="text-[#d4d4d0]">/</span>
          <span className="font-semibold text-[#111110]">{client.client_name}</span>
        </div>

        {/* Client header */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-[#111110]">{client.client_name}</h1>
              {client.client_phone && (
                <a href={`tel:${client.client_phone}`} className="text-[15px] text-blue-600 mt-1 block">{client.client_phone}</a>
              )}
              {client.object_address && (
                <p className="text-[13px] text-[#9a9a95] mt-0.5">{client.object_address}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[22px] font-bold text-[#111110] font-mono">{fmt(totalRevenue)}</p>
              <p className="text-[12px] text-[#9a9a95]">суммарная выручка</p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-[#f0f0ec] grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-[22px] font-bold text-[#111110]">{orders.length}</p>
              <p className="text-[11px] text-[#9a9a95]">заказов всего</p>
            </div>
            <div className="text-center">
              <p className="text-[22px] font-bold text-blue-600">{activeOrders.length}</p>
              <p className="text-[11px] text-[#9a9a95]">активных</p>
            </div>
            <div className="text-center">
              <p className="text-[22px] font-bold text-emerald-600">
                {orders.filter(o => o.status !== 'cancelled').length > 0
                  ? (orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.margin_percent, 0) / orders.filter(o => o.status !== 'cancelled').length).toFixed(1)
                  : '—'}%
              </p>
              <p className="text-[11px] text-[#9a9a95]">средняя маржа</p>
            </div>
          </div>
        </div>

        {/* Orders */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden mb-4">
          <div className="px-5 py-3 bg-[#f8f8f7] border-b border-[#e4e4e0]">
            <p className="text-[12px] font-bold text-[#9a9a95] uppercase tracking-wider">Заказы</p>
          </div>
          {orders.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-[#9a9a95]">Нет заказов</p>
          ) : (
            <div className="divide-y divide-[#f0f0ec]">
              {orders.map(o => (
                <Link key={o.id} href={`/orders/${o.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-[#fafaf9] transition-colors">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold font-mono text-[#111110]">{o.number}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${STATUS_STYLE[o.status as OrderStatus]}`}>
                        {ORDER_STATUS_LABELS[o.status as OrderStatus]}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#9a9a95] mt-0.5">
                      {new Date(o.created_at).toLocaleDateString('ru-RU')}
                      {o.order_type && ` · ${o.order_type}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[14px] font-bold font-mono text-[#111110]">{fmt(o.total_sale_price)}</p>
                    <p className="text-[11px] text-[#9a9a95]">Маржа {o.margin_percent.toFixed(1)}%</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Back link */}
        <Link href="/clients" className="text-[13px] text-[#9a9a95] hover:text-[#6b6b66]">
          ← Все клиенты
        </Link>
      </div>
    </div>
  )
}
