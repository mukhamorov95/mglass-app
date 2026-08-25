import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { applyClientPrices, loadClientPrices } from '@/lib/b2b/clientPrices'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import type { B2BMaterial } from '@/lib/types'
import { resolvePartnerClient } from '@/lib/partnerClient'

// Справочники для партнёрского калькулятора. Отдаём ТОЛЬКО безопасные поля:
// материалы (id/имя/категория/толщина/цена продажи), опции фацета (мм + цена),
// правила надбавок за габариты (для подсветки клиенту). Никакой себестоимости/
// отхода/маржи. Считает и фильтрует сервер (service-role), партнёр к таблицам не ходит.

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const client = await resolvePartnerClient<{ id: number; name: string; discount_percent: number | null }>(svc, user.id, 'id,name,discount_percent')
  if (!client) return NextResponse.json({ linked: false, materials: [], facetOptions: [], surcharges: [] })

  const [{ data: mats }, { data: matrix }, { data: facets }, { data: surchargeData }] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true).order('category').order('name'),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('facet_prices').select('type_mm,sale_price').eq('active', true).order('type_mm'),
    svc.from('b2b_surcharge_rules').select('id,axis,min_mm,max_mm,surcharge_percent,label,shape_filter').eq('active', true).order('sort_order'),
  ])

  const priced = prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>)

  // deny-by-default: наружу только безопасные поля
  // А12: в справочнике кабинета показываем цены этого клиента, если они заданы —
  // иначе партнёр увидел бы одну цену в списке, а в расчёте другую.
  const withClientPrices = applyClientPrices(priced, await loadClientPrices(svc, client.id))
  const materials = withClientPrices
    .filter(m => (m.sale_price ?? 0) > 0)          // без цены — клиенту не показываем
    .map(m => ({ id: m.id, name: m.name, category: m.category, thickness: m.thickness, salePrice: m.sale_price }))

  const facetOptions = (facets ?? []).map((f: Record<string, unknown>) => ({
    typeMm: Number(f.type_mm), salePrice: Number(f.sale_price),
  }))

  // Правила надбавок — только «клиентские» поля (процент/границы/подпись), без себестоимости.
  const surcharges = (surchargeData ?? []) as Array<Record<string, unknown>>

  return NextResponse.json({
    linked: true,
    discountPercent: Number(client.discount_percent) || 0,
    materials, facetOptions, surcharges,
  })
}
