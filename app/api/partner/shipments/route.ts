import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolvePartnerMember } from '@/lib/partnerClient'
import { permsOf } from '@/lib/partner/teamRoles'
import { SHOWER_GLASS } from '@/lib/production/clientShipments'
import { readClientShipments } from '@/lib/production/clientShipmentsRead'
import { partnerOrders, partnerShipments } from '@/lib/partner/shipmentsView'
import type { PoolOrder, Shipment } from '@/app/production-app/shower-glass/types'

// Вкладка «Отгрузки» кабинета: то же чтение, что у цеха на экране Шовер Гласс, урезанное до
// того, что положено клиенту. Учёт отгрузок по изделиям ведётся пока только для Шовер Гласс.

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = createServiceClient()
  const pm = await resolvePartnerMember<{ id: number }>(svc, user.id, 'id')
  if (!pm) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })
  if (pm.client.id !== SHOWER_GLASS.clientId) return NextResponse.json({ available: false })

  const perms = permsOf(pm.role)
  try {
    const r = await readClientShipments(svc, perms.prices)
    return NextResponse.json({
      available: true, today: r.today, money: perms.prices, finance: perms.finance,
      orders: partnerOrders(r.orders as PoolOrder[], perms.prices),
      shipments: partnerShipments(r.shipments as Shipment[], perms.prices),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка загрузки' }, { status: 500 })
  }
}
