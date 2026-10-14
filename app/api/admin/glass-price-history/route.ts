import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { getRole } from '@/lib/getRole'

// История себестоимости: «какая цена была, когда действовал прайс от такой-то даты».
// Без параметров — сводка для справочника «Стекло»: действующий прайс, прошлый
// и что изменилось при его применении (было → стало по каждой ячейке).
// Себестоимость видят те же роли, что открывают справочник: владелец и закупщик.
const COST_ROLES = new Set(['admin', 'ceo', 'buyer'])

export async function GET(req: NextRequest) {
  const role = await getRole()
  if (!role || !COST_ROLES.has(role)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

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
    const previous = current
      ? (lists ?? []).find(l => l.id !== current.id && l.supplier === current.supplier && l.price_date < current.price_date) ?? null
      : null
    const { data: changes } = current
      ? await supa.from('glass_price_apply_log')
        .select('matrix_name, matrix_category, thickness, old_value, new_value')
        .eq('list_id', current.id)
      : { data: [] }
    return NextResponse.json({ current, previous, changes: changes ?? [], total: (lists ?? []).length, lists: lists ?? [] })
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
