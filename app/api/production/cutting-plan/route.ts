import { NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { DEFAULT_CUTTING_SETTINGS, type CuttingSettings } from '@/lib/cuttingOptimizer'

// Режим резчика на табло цеха: справочник листов (форматы, кромка, рисунок) и настройки
// раскроя. Себестоимость цеху не отдаём — раскладке она не нужна.
export async function GET() {
  const guard = await requirePageAccess('/production-app/control')
  if (guard instanceof NextResponse) return guard
  const svc = createServiceClient()
  const [mats, vars, set] = await Promise.all([
    svc.from('b2b_materials').select('id, name, thickness, category, sheet_width, sheet_height, sheet_edge_mm, pattern_direction').eq('active', true),
    svc.from('b2b_material_sheet_variants').select('material_id, sheet_width, sheet_height, active'),
    svc.from('cutting_settings').select('*').eq('id', 1).maybeSingle(),
  ])
  const err = mats.error ?? vars.error ?? set.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })
  return NextResponse.json({
    materials: (mats.data ?? []).map(m => ({ ...m, cost_price: null })),
    variants: vars.data ?? [],
    settings: { ...DEFAULT_CUTTING_SETTINGS, ...((set.data ?? {}) as Partial<CuttingSettings>) },
  })
}
