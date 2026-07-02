import { createClient } from '@/lib/supabase-server'
import Link from 'next/link'
import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'
import { PageHeader, RowCard, StatusPill, EmptyState, IcSearch } from '@/components/ds'

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

  // Fetch calculation clients (not yet converted to orders)
  let calcQuery = supabase
    .from('calculations')
    .select('client_name, client_phone, final_price, margin, created_at')
    .not('client_name', 'is', null)
    .order('created_at', { ascending: false })

  if (role !== 'admin') calcQuery = calcQuery.eq('created_by', user!.id)
  const { data: calcRows } = await calcQuery

  type ClientEntry = {
    name: string
    phone: string | null
    key: string
    orderCount: number
    calcCount: number
    totalRevenue: number
    lastActivityAt: string
    avgMargin: number
  }

  const clientMap = new Map<string, ClientEntry>()

  for (const o of (orders ?? [])) {
    const key = (o as any).client_phone?.trim() || (o as any).client_name?.trim()
    if (!key) continue
    const existing = clientMap.get(key)
    if (existing) {
      existing.orderCount++
      existing.totalRevenue += (o as any).total_sale_price
      existing.avgMargin = (existing.avgMargin + (o as any).margin_percent) / 2
      if ((o as any).created_at > existing.lastActivityAt) existing.lastActivityAt = (o as any).created_at
    } else {
      clientMap.set(key, {
        name:        (o as any).client_name,
        phone:       (o as any).client_phone,
        key,
        orderCount:  1,
        calcCount:   0,
        totalRevenue: (o as any).total_sale_price,
        lastActivityAt: (o as any).created_at,
        avgMargin:   (o as any).margin_percent,
      })
    }
  }

  // Merge calculation clients (only those not already in orders map)
  for (const c of (calcRows ?? [])) {
    const key = (c as any).client_phone?.trim() || (c as any).client_name?.trim()
    if (!key) continue
    const existing = clientMap.get(key)
    if (existing) {
      existing.calcCount++
      if ((c as any).created_at > existing.lastActivityAt) existing.lastActivityAt = (c as any).created_at
    } else {
      clientMap.set(key, {
        name:        (c as any).client_name,
        phone:       (c as any).client_phone,
        key,
        orderCount:  0,
        calcCount:   1,
        totalRevenue: 0,
        lastActivityAt: (c as any).created_at,
        avgMargin:   (c as any).margin,
      })
    }
  }

  const clients = Array.from(clientMap.values())
    .sort((a, b) => b.totalRevenue - a.totalRevenue || b.lastActivityAt.localeCompare(a.lastActivityAt))

  return (
    <div className="bg-canvas min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-6">
        <PageHeader
          title="Клиенты"
          subtitle="История заказов по клиентам"
          actions={<span className="text-[13px] text-muted">{clients.length} клиентов</span>}
        />

        {clients.length === 0 ? (
          <EmptyState icon={<IcSearch className="w-8 h-8" />} title="Нет клиентов" />
        ) : (
          <div className="space-y-2">
            {clients.map(c => (
              <Link key={c.key} href={`/clients/${encodeURIComponent(c.key)}`} className="block hover:opacity-95 transition-opacity">
                <RowCard
                  title={
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{c.name}</span>
                      {c.orderCount === 0 && (
                        <StatusPill tone="warning">только расчёт</StatusPill>
                      )}
                    </span>
                  }
                  subtitle={
                    <>
                      {c.phone && <span>{c.phone}</span>}
                      {c.phone && ' · '}
                      Активность: {new Date(c.lastActivityAt).toLocaleDateString('ru-RU')}
                    </>
                  }
                  amount={c.totalRevenue > 0 ? fmt(c.totalRevenue) : <span className="text-[13px] font-normal text-muted">нет заказов</span>}
                  amountSub={
                    <span className="text-[11px]">
                      <span className="text-muted">
                        {c.orderCount > 0 ? `${c.orderCount} заказ(ов)` : ''}
                        {c.calcCount > 0 ? `${c.orderCount > 0 ? ' · ' : ''}${c.calcCount} расчёт(ов)` : ''}
                      </span>
                      {c.avgMargin > 0 && (
                        <span className="block text-emerald-600 font-medium">Маржа {c.avgMargin.toFixed(1)}%</span>
                      )}
                    </span>
                  }
                />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
