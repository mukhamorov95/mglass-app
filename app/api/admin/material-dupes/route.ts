import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { materialDupes, serviceDupes, type MaterialRow, type ServiceRow } from '@/lib/b2b/dupeAudit'

export const dynamic = 'force-dynamic'

// Отчёт «подозрение на дубль» справочника. Себестоимость видят только владелец и
// снабжение — гейт ролью. Данные НЕ правим и строки не сливаем: даём картину,
// решение о слиянии за владельцем.
const ALLOWED = ['admin', 'ceo', 'buyer'] as const

const n = (v: unknown) => Number(v) || 0

export async function GET() {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard

  const svc = createServiceClient()

  const [{ data: mats }, { data: svcs }, { data: orders }] = await Promise.all([
    svc.from('b2b_materials').select('id,name,category,thickness,cost_price,waste_percent,active'),
    svc.from('b2b_services').select('id,name,type,cost_price,active'),
    // Частота использования за ~4 месяца — по materialId (точно, а не по имени).
    svc.from('b2b_orders').select('items').is('archived_at', null).gte('created_at', '2026-05-01').limit(6000),
  ])

  const usesByMat = new Map<number, number>()
  for (const o of (orders ?? []) as { items: unknown }[]) {
    const items = Array.isArray(o.items) ? o.items as Record<string, unknown>[] : []
    for (const it of items) {
      const mid = n(it.materialId)
      if (mid > 0) usesByMat.set(mid, (usesByMat.get(mid) ?? 0) + 1)
    }
  }

  const matRows: MaterialRow[] = ((mats ?? []) as Record<string, unknown>[]).map(m => ({
    id: n(m.id), name: String(m.name ?? ''), category: (m.category as string | null) ?? null,
    thickness: n(m.thickness), cost_price: n(m.cost_price),
    waste_percent: m.waste_percent == null ? null : n(m.waste_percent),
    active: m.active === true, uses: usesByMat.get(n(m.id)) ?? 0,
  }))

  // Услуги в позициях лежат вложенным массивом services[{id,...}] — считаем по нему.
  const usesBySvc = new Map<number, number>()
  for (const o of (orders ?? []) as { items: unknown }[]) {
    const items = Array.isArray(o.items) ? o.items as Record<string, unknown>[] : []
    for (const it of items) {
      const services = Array.isArray(it.services) ? it.services as Record<string, unknown>[] : []
      for (const s of services) {
        const sid = n(s.id)
        if (sid > 0) usesBySvc.set(sid, (usesBySvc.get(sid) ?? 0) + 1)
      }
    }
  }

  const svcRows: ServiceRow[] = ((svcs ?? []) as Record<string, unknown>[]).map(s => ({
    id: n(s.id), name: String(s.name ?? ''), type: (s.type as string | null) ?? null,
    cost_price: s.cost_price == null ? null : n(s.cost_price),
    active: s.active === true, uses: usesBySvc.get(n(s.id)) ?? 0,
  }))

  const materials = materialDupes(matRows)
  const services = serviceDupes(svcRows)

  return NextResponse.json({
    materials,
    services,
    summary: {
      materialGroups: materials.length,
      materialConflicts: materials.filter(g => g.costConflict).length,
      topPriceOfQuestion: materials[0]?.priceOfQuestion ?? 0,
      serviceGroups: services.length,
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
