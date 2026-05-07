import { createClient } from '@/lib/supabase-server'
import Link from 'next/link'
import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

export default async function ClientsPage() {
  const supabase = await createClient()
  const role = await getRole()
  if (!role) redirect('/login')

  const { data: { user } } = await supabase.auth.getUser()

  // Fetch orders (filter by manager for non-admins)
  let query = supabase
    .from('orders')
    .select('id, client_name, client_phone, total_sale_price, status, created_at, margin_percent')
    .not('status', 'eq', 'cancelled')
    .order('created_at', { ascending: false })

  if (role !== 'admin') query = query.eq('manager_id', user!.id)

  const { data: orders } = await query

  // Group by client (by phone, fall back to name)
  const clientMap = new Map<string, {
    name: string
    phone: string | null
    key: string
    orderCount: number
    totalRevenue: number
    lastOrderAt: string
    avgMargin: number
  }>()

  for (const o of (orders ?? [])) {
    const key = (o as any).client_phone?.trim() || (o as any).client_name?.trim()
    if (!key) continue
    const existing = clientMap.get(key)
    if (existing) {
      existing.orderCount++
      existing.totalRevenue += (o as any).total_sale_price
      existing.avgMargin = (existing.avgMargin + (o as any).margin_percent) / 2
      if ((o as any).created_at > existing.lastOrderAt) existing.lastOrderAt = (o as any).created_at
    } else {
      clientMap.set(key, {
        name:        (o as any).client_name,
        phone:       (o as any).client_phone,
        key,
        orderCount:  1,
        totalRevenue: (o as any).total_sale_price,
        lastOrderAt: (o as any).created_at,
        avgMargin:   (o as any).margin_percent,
      })
    }
  }

  const clients = Array.from(clientMap.values())
    .sort((a, b) => b.totalRevenue - a.totalRevenue)

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Клиенты</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">История заказов по клиентам</p>
          </div>
          <p className="text-[13px] text-[#9a9a95]">{clients.length} клиентов</p>
        </div>

        {clients.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e4e4e0] p-12 text-center">
            <p className="text-[13px] text-[#9a9a95]">Нет клиентов</p>
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map(c => (
              <Link
                key={c.key}
                href={`/clients/${encodeURIComponent(c.key)}`}
                className="block bg-white rounded-xl border border-[#e4e4e0] px-5 py-4 hover:border-[#c4c4c0] hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[15px] font-semibold text-[#111110]">{c.name}</p>
                    {c.phone && <p className="text-[13px] text-[#9a9a95] mt-0.5">{c.phone}</p>}
                    <p className="text-[12px] text-[#b4b4b0] mt-0.5">
                      Последний заказ: {new Date(c.lastOrderAt).toLocaleDateString('ru-RU')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[16px] font-bold text-[#111110] font-mono">{fmt(c.totalRevenue)}</p>
                    <p className="text-[12px] text-[#9a9a95]">{c.orderCount} заказ(ов)</p>
                    <p className="text-[12px] text-emerald-600 font-medium">
                      Маржа {c.avgMargin.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
