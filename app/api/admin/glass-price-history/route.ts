import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { getRole } from '@/lib/getRole'

// История себестоимости: «какая цена была, когда действовал прайс от такой-то даты».
// Без параметров — краткая сводка для кнопки в справочнике «Стекло».
export async function GET(req: NextRequest) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const supa = createServiceClient()
  const name = req.nextUrl.searchParams.get('name')
  const category = req.nextUrl.searchParams.get('category')
  const thickness = Number(req.nextUrl.searchParams.get('thickness'))

  const { data: lists } = await supa
    .from('glass_price_lists')
    .select('id, supplier, title, price_date, status, applied_at, file_name')
    .order('price_date', { ascending: false })

  const current = (lists ?? []).find(l => l.status === 'applied') ?? null

  if (!name || !category) {
    return NextResponse.json({ current, total: (lists ?? []).length, lists: lists ?? [] })
  }

  let q = supa.from('glass_price_apply_log')
    .select('*')
    .eq('matrix_name', name)
    .eq('matrix_category', category)
    .order('applied_at', { ascending: false })
    .limit(100)
  if (Number.isFinite(thickness) && thickness > 0) q = q.eq('thickness', thickness)

  const { data: log, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byId = new Map((lists ?? []).map(l => [l.id, l]))
  return NextResponse.json({
    current,
    history: (log ?? []).map(r => ({ ...r, price_date: byId.get(r.list_id)?.price_date ?? null, list_title: byId.get(r.list_id)?.title ?? '' })),
  })
}
