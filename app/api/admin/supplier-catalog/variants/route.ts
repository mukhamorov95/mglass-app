import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Варианты позиции по цветам: по id выбранной строки берём базовый артикул
// (без цветового суффикса после последнего «/») и возвращаем все его цвета
// у того же поставщика — чтобы разом заполнить цены визуализатора по цветам.

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const supa = createServiceClient()
  const { data: row } = await supa.from('supplier_price_rows')
    .select('supplier,article,name,url,image_url,specs').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'не найдено' }, { status: 404 })

  const slash = row.article.lastIndexOf('/')
  const base = slash > 0 ? row.article.slice(0, slash) : row.article
  const esc = base.replace(/[%_]/g, (s: string) => `\\${s}`)

  const { data: variants } = await supa.from('supplier_price_rows')
    .select('id,color,cost_price,retail_price')
    .eq('supplier', row.supplier)
    .or(`article.eq.${base},article.ilike.${esc}/%`)
    .order('color')

  return NextResponse.json({
    supplier: row.supplier, base, name: row.name, variants: variants ?? [],
    url: row.url ?? '', imageUrl: row.image_url ?? '', specs: row.specs ?? {},
  })
}
