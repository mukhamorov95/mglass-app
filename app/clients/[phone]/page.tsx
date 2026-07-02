import { createClient } from '@/lib/supabase-server'
import Link from 'next/link'
import { getRole } from '@/lib/getRole'
import { redirect, notFound } from 'next/navigation'
import { ORDER_STATUS_LABELS } from '@/lib/types'
import type { OrderStatus } from '@/lib/types'
import { StatusPill, MetricTile, IcArrowLeft, type PillTone } from '@/components/ds'

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

const PRODUCT_LABELS: Record<string, { label: string; emoji: string }> = {
  mirror:          { label: 'Зеркало', emoji: '🪞' },
  loft:            { label: 'Лофт',    emoji: '🏗️' },
  shower:          { label: 'Душевая', emoji: '🚿' },
  shower_standard: { label: 'Душевая', emoji: '🚿' },
  shower_budget:   { label: 'Душевая', emoji: '🚿' },
}

const CALC_STATUS: Record<string, string> = {
  draft:    'Черновик',
  sent:     'Отправлено',
  thinking: 'Думает',
  approved: 'Согласовано',
  launched: 'Запущено',
  rejected: 'Отказ',
}

const STATUS_TONE: Record<OrderStatus, PillTone> = {
  draft:            'neutral',
  pending_approval: 'danger',
  approved:         'warning',
  in_work:          'accent',
  completed:        'success',
  cancelled:        'neutral',
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

  // Fetch calculations matching this client's phone or name
  const { data: calcs } = await supabase
    .from('calculations')
    .select('id, product_type, final_price, margin, status, created_at, client_text, client_name, client_phone')
    .or(`client_phone.eq.${key},client_name.eq.${key}`)
    .order('created_at', { ascending: false })
    .limit(20)

  if (!orders?.length && !calcs?.length) notFound()

  const client = orders?.[0] ?? {
    client_name: calcs?.[0]?.client_name ?? key,
    client_phone: calcs?.[0]?.client_phone ?? null,
    object_address: null,
  }
  const safeOrders = orders ?? []
  const totalRevenue = safeOrders
    .filter(o => o.status !== 'cancelled')
    .reduce((s, o) => s + o.total_sale_price, 0)

  const activeOrders = safeOrders.filter(o => ['in_work', 'approved', 'pending_approval'].includes(o.status))

  return (
    <div className="bg-canvas min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-6">

        <div className="flex items-center gap-2 text-[13px] mb-5">
          <Link href="/clients" className="text-muted hover:text-ink-soft transition-colors">← Клиенты</Link>
          <span className="text-faint">/</span>
          <span className="font-semibold text-ink">{client.client_name}</span>
        </div>

        {/* Client header */}
        <div className="bg-surface rounded-xl border border-line p-6 mb-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[22px] font-semibold text-ink tracking-[-0.01em]">{client.client_name}</h1>
              {client.client_phone && (
                <a href={`tel:${client.client_phone}`} className="text-[15px] text-blue-600 mt-1 block">{client.client_phone}</a>
              )}
              {client.object_address && (
                <p className="text-[13px] text-muted mt-0.5">{client.object_address}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-[22px] font-semibold text-ink font-mono tabular-nums">{fmt(totalRevenue)}</p>
              <p className="text-[12px] text-muted">суммарная выручка</p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-line-soft grid grid-cols-3 gap-3">
            <MetricTile label="заказов всего" value={safeOrders.length} />
            <MetricTile label="активных" value={<span className="text-blue-600">{activeOrders.length}</span>} />
            <MetricTile
              label="средняя маржа"
              value={
                <span className="text-emerald-600">
                  {safeOrders.filter(o => o.status !== 'cancelled').length > 0
                    ? (safeOrders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + o.margin_percent, 0) / safeOrders.filter(o => o.status !== 'cancelled').length).toFixed(1)
                    : '—'}%
                </span>
              }
            />
          </div>
        </div>

        {/* Orders */}
        <div className="bg-surface rounded-xl border border-line overflow-hidden mb-4">
          <div className="px-5 py-3 bg-subtle border-b border-line">
            <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">Заказы</p>
          </div>
          {safeOrders.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted">Нет заказов</p>
          ) : (
            <div className="divide-y divide-line-soft">
              {safeOrders.map(o => (
                <Link key={o.id} href={`/orders/${o.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-subtle transition-colors">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold font-mono text-ink">{o.number}</span>
                      <StatusPill tone={STATUS_TONE[o.status as OrderStatus]}>{ORDER_STATUS_LABELS[o.status as OrderStatus]}</StatusPill>
                    </div>
                    <p className="text-[11px] text-muted mt-0.5">
                      {new Date(o.created_at).toLocaleDateString('ru-RU')}
                      {o.order_type && ` · ${o.order_type}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[14px] font-semibold font-mono text-ink tabular-nums">{fmt(o.total_sale_price)}</p>
                    <p className="text-[11px] text-muted">Маржа {o.margin_percent.toFixed(1)}%</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Calculations */}
        {calcs && calcs.length > 0 && (
          <div className="bg-surface rounded-xl border border-line overflow-hidden mb-4">
            <div className="px-5 py-3 bg-subtle border-b border-line">
              <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">Расчёты ({calcs.length})</p>
            </div>
            <div className="divide-y divide-line-soft">
              {calcs.map(c => {
                const prod = PRODUCT_LABELS[c.product_type] ?? { label: c.product_type, emoji: '📋' }
                const statusLabel = CALC_STATUS[c.status] ?? c.status
                return (
                  <Link key={c.id} href={`/calculations/${c.id}`}
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-subtle transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px]">{prod.emoji}</span>
                        <span className="text-[13px] font-semibold text-ink">{prod.label}</span>
                        <StatusPill tone="neutral">{statusLabel}</StatusPill>
                      </div>
                      <p className="text-[11px] text-muted mt-0.5">
                        {new Date(c.created_at).toLocaleDateString('ru-RU')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[14px] font-semibold font-mono text-ink tabular-nums">{fmt(c.final_price)}</p>
                      <p className="text-[11px] text-muted">Маржа {c.margin.toFixed(1)}%</p>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Back link */}
        <Link href="/clients" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink-soft transition-colors">
          <IcArrowLeft className="w-3.5 h-3.5" />Все клиенты
        </Link>
      </div>
    </div>
  )
}
