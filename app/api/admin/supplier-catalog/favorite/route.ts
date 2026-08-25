import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Отметка «наша позиция» — логист помечает строки справочника, которые компания
// реально закупает. Влияет только на выдачу справочника (наверху + фильтр).
export async function POST(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => null) as { id?: number; favorite?: boolean } | null
  if (!body?.id || typeof body.favorite !== 'boolean') {
    return NextResponse.json({ error: 'id + favorite обязательны' }, { status: 400 })
  }
  const supa = createServiceClient()
  const { error } = await supa.from('supplier_price_rows')
    .update({ is_favorite: body.favorite, updated_at: new Date().toISOString() })
    .eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: body.id, favorite: body.favorite })
}
