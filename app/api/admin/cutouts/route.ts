import { NextResponse } from 'next/server'
import { requirePageAccess } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { writeLogForCurrentUser } from '@/lib/activityLog'

// Справочник вырезов (b2b_services, код cutout_*): себестоимость и продажа за штуку.
// Пускает тех, кто открывает /admin/cutouts (владелец и закупка); пишет только строки вырезов.
const PAGE = '/admin/cutouts'

export async function GET() {
  const guard = await requirePageAccess(PAGE)
  if (guard instanceof NextResponse) return guard
  const { data, error } = await createServiceClient()
    .from('b2b_services').select('id, code, name, value, cost_price, active, sort_order')
    .like('code', 'cutout_%').order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rows: data ?? [] })
}

const money = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(n) && n >= 0 && n < 1_000_000 ? Math.round(n * 100) / 100 : null
}

export async function PATCH(req: Request) {
  const guard = await requirePageAccess(PAGE)
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => null) as { id?: unknown; value?: unknown; cost_price?: unknown } | null
  const id = Number(body?.id)
  const value = money(body?.value)
  const cost = money(body?.cost_price)
  if (!Number.isInteger(id) || id <= 0 || value === null || cost === null) {
    return NextResponse.json({ error: 'Нужны id, продажа и себестоимость — числа от 0' }, { status: 400 })
  }
  const db = createServiceClient()
  const { data: before } = await db.from('b2b_services').select('id, code, name, value, cost_price').eq('id', id).maybeSingle()
  if (!before || !String(before.code ?? '').startsWith('cutout_')) {
    return NextResponse.json({ error: 'Это не строка выреза' }, { status: 404 })
  }
  const { data, error } = await db.from('b2b_services')
    .update({ value, cost_price: cost }).eq('id', id).select('id, code, name, value, cost_price, active, sort_order').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Не сохранено' }, { status: 500 })
  await writeLogForCurrentUser('price.cutout_update', {
    entityType: 'b2b_services', entityId: String(id),
    details: { name: before.name, sale: [Number(before.value), value], cost: [Number(before.cost_price), cost] },
  })
  return NextResponse.json({ row: data })
}
