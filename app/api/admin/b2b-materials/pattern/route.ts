import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Направленность рисунка стекла (фактурное/рифлёное) — на материале b2b_materials.
// 'none' | 'along_length' | 'along_width'. Оптимизатор раскроя уважает её и
// запрещает поворот детали на 90° (см. lib/cuttingOptimizer.ts effectiveSettings).
const VALID = ['none', 'along_length', 'along_width']

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const materialId = Number(body?.materialId)
  const dir = String(body?.pattern_direction ?? '')
  if (!materialId || !VALID.includes(dir)) {
    return NextResponse.json({ ok: false, error: 'Некорректные данные' }, { status: 400 })
  }

  const svc = createServiceClient()
  const { error } = await svc.from('b2b_materials').update({ pattern_direction: dir }).eq('id', materialId)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
