import { NextResponse, type NextRequest } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { articleBase } from '@/lib/supplier/colorCode'

// Варианты позиции по цветам: по id выбранной строки берём базовый артикул (без кода
// цвета; у АВ24 материал остаётся в базе — FDP-115 BR и FDP-115 SUS304 разные петли)
// и возвращаем все его цвета у того же поставщика — чтобы разом заполнить цены по цветам.
// Цвет и себестоимость строк разбирает вызывающий (lib/supplier/colorCode.ts).

export async function GET(req: NextRequest) {
  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard
  const id = Number(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const supa = createServiceClient()
  const { data: row } = await supa.from('supplier_price_rows')
    .select('supplier,article,name,url,image_url,specs').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'не найдено' }, { status: 404 })

  const base = articleBase(row.supplier, row.article)
  const esc = base.replace(/[%_]/g, (s: string) => `\\${s}`)

  const { data: variants } = await supa.from('supplier_price_rows')
    .select('id,article,name,color,cost_price,retail_price,discount_percent')
    .eq('supplier', row.supplier)
    .or(`article.eq.${base},article.ilike.${esc}/%`)
    .order('article')

  // Ровно эта база: у Ветро длина в середине артикула («ПР-004/1500/Black») — префикс
  // захватил бы соседние длины.
  const own = (variants ?? []).filter(v => v.article === base || articleBase(row.supplier, v.article) === base)
  return NextResponse.json({
    supplier: row.supplier, base, name: row.name, variants: own,
    url: row.url ?? '', imageUrl: row.image_url ?? '', specs: row.specs ?? {},
  })
}
