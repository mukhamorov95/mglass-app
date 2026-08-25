import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Общий справочник цен поставщиков: поиск/фильтр строк + правка скидки поставщика.
// Доступ — owner-tier + логист-закупщик (buyer). Запись — сервис-role (RLS: только чтение).

const PAGE = 50
const ALLOWED = ['admin', 'ceo', 'buyer'] as const

export async function GET(req: NextRequest) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard
  const sp = req.nextUrl.searchParams
  const supplier = sp.get('supplier') || 'vetro'   // 'all' — по всем поставщикам
  const category = sp.get('category') || ''
  const q = (sp.get('q') || '').trim()
  const page = Math.max(0, Number(sp.get('page') || 0))
  const favOnly = sp.get('favorites') === '1'      // только «наши позиции»

  const supa = createServiceClient()
  const [{ data: sources }, { data: cats }, { count: favTotal }] = await Promise.all([
    supa.from('supplier_price_sources').select('*').order('title'),
    supplier === 'all' ? Promise.resolve({ data: [] }) : supa.rpc('supplier_price_categories', { sup: supplier }),
    supa.from('supplier_price_rows').select('id', { count: 'exact', head: true }).eq('is_favorite', true),
  ])

  let query = supa.from('supplier_price_rows')
    .select('id,supplier,category,article,name,color,unit,retail_price,discount_percent,cost_price,url,is_favorite', { count: 'exact' })
  if (supplier !== 'all') query = query.eq('supplier', supplier)
  if (category) query = query.eq('category', category)
  if (favOnly) query = query.eq('is_favorite', true)
  if (q) query = query.or(`name.ilike.%${q}%,article.ilike.%${q}%`)
  // Избранное («наши позиции») всегда наверху списка.
  query = query.order('is_favorite', { ascending: false }).order('category').order('name')
    .range(page * PAGE, page * PAGE + PAGE - 1)
  const { data: rows, count } = await query

  return NextResponse.json({
    sources: sources ?? [],
    categories: cats ?? [],
    rows: rows ?? [],
    total: count ?? 0,
    favTotal: favTotal ?? 0,
    page, pageSize: PAGE,
  })
}

// Правка скидки поставщика → пересчёт себестоимости всех его строк.
export async function PATCH(req: NextRequest) {
  const guard = await requireRole([...ALLOWED])
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => null) as { supplier?: string; discount_percent?: number } | null
  if (!body?.supplier || typeof body.discount_percent !== 'number') {
    return NextResponse.json({ error: 'supplier + discount_percent обязательны' }, { status: 400 })
  }
  const disc = Math.max(0, Math.min(100, body.discount_percent))
  const supa = createServiceClient()
  const { error: e1 } = await supa.from('supplier_price_sources')
    .update({ discount_percent: disc, updated_at: new Date().toISOString() }).eq('supplier', body.supplier)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  // Пересчёт cost_price = round(retail × (1 − disc/100)) для всех строк поставщика.
  const { error: e2 } = await supa.rpc('supplier_price_reprice', { sup: body.supplier, disc })
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  return NextResponse.json({ ok: true, discount_percent: disc })
}
