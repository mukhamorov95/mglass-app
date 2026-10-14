import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'
import { loadDemoRefs, temperableOf } from '../_refs'

export const dynamic = 'force-dynamic'

// Демо GLASMEN: материалы с общим прайсом за м² (вкл. НДС 22 %). Только владелец.
// Наружу — ни закупки, ни отхода, ни ставок: только то, что видит клиент в прайсе.
export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const refs = await loadDemoRefs(createServiceClient())
  if ('error' in refs) return NextResponse.json({ error: refs.error }, { status: 500 })

  const materials = refs.materials
    .map(m => ({
      id: m.id,
      name: m.name,
      category: m.category,
      thickness: m.thickness,
      pricePerM2: Math.round(m.sale_price ?? 0),
      temperable: temperableOf(m, refs.rates),
    }))
    .sort((a, b) => a.category.localeCompare(b.category, 'ru') || a.thickness - b.thickness || a.name.localeCompare(b.name, 'ru'))

  const categories = [...new Set(materials.map(m => m.category))].map(category => ({
    category, count: materials.filter(m => m.category === category).length,
  }))
  const unknown = materials.filter(m => m.temperable === null).length
  // Ширины фацета — из активных строк facet_prices; цены фацета наружу не отдаём, только ширины.
  const facetTypesMm = [...new Set(refs.facetPrices.map(f => Number(f.type_mm)).filter(n => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)

  return NextResponse.json({
    materials,
    categories,
    combos: materials.length,
    facetTypesMm,
    summary: { count: materials.length, text: `${materials.length} сочетаний материал × толщина` },
    notes: [
      'pricePerM2 — общий прайс B2B за м² с НДС 22 %, до скидки клиента; закалка, кромка, сверловка и вырезы в цену м² уже входят; фацет и триплекс — отдельно.',
      'temperable: зеркало — false; стекло — true, если в b2b_rates есть ставка закалки этой толщины, иначе null (неизвестно).',
    ],
    warnings: [
      ...refs.warnings,
      ...(unknown ? [`У ${unknown} сочетаний закаляемость неизвестна: нет ставки закалки для их толщины в b2b_rates`] : []),
    ],
  })
}
