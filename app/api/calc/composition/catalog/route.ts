import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requireAnyPageAccess } from '@/lib/apiAuth'
import { buildCatalog, CATALOG_GROUPS, type CatalogRow } from '@/lib/calc/compositionCatalog'

export const dynamic = 'force-dynamic'

// Каталог фурнитуры конструктора (CONSTRUCTOR_ROUTE.md, К1): модели АВ24 с фото и закупкой
// по цвету. Закупку видят те же, кому открыт расчёт по составу. Читаем весь активный
// АВ24 (~3,7 тыс. строк) и отбираем разделы в коде: шесть десятков названий в фильтре
// запроса дают адрес в десятки килобайт.
export async function GET() {
  const guard = await requireAnyPageAccess(['/calculator/build', '/calculator/quick'])
  if (guard instanceof NextResponse) return guard

  const svc = createServiceClient()
  const rows: CatalogRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc.from('supplier_price_rows')
      .select('article,name,color,retail_price,discount_percent,cost_price,category,image_url,url')
      .eq('supplier', 'av24').eq('active', true)
      .order('id').range(from, from + 999)
    if (error) return NextResponse.json({ error: `Справочник АВ24 не прочитан: ${error.message}` }, { status: 500 })
    rows.push(...((data ?? []) as CatalogRow[]))
    if (!data || data.length < 1000) break
  }
  const models = buildCatalog(rows)
  return NextResponse.json(
    { groups: CATALOG_GROUPS.map(g => ({ id: g.id, label: g.label })), models },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  )
}
