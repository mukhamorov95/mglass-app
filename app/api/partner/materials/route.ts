import { isClientCalculable } from '@/lib/glass/clientMaterials'
import { publicServices } from '@/lib/partner/partnerServices'
import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { applyClientPrices, loadClientPrices } from '@/lib/b2b/clientPrices'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import type { B2BMaterial, B2BService } from '@/lib/types'
import { denyUnless, resolvePartnerMember } from '@/lib/partnerClient'

// Справочники для партнёрского калькулятора. Отдаём ТОЛЬКО безопасные поля:
// материалы (id/имя/категория/толщина/цена продажи), опции фацета (мм + цена),
// правила надбавок за габариты (для подсветки клиенту). Никакой себестоимости/
// отхода/маржи. Считает и фильтрует сервер (service-role), партнёр к таблицам не ходит.

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const pm = await resolvePartnerMember<{ id: number; name: string; discount_percent: number | null }>(svc, user.id, 'id,name,discount_percent')
  if (!pm) return NextResponse.json({ linked: false, materials: [], facetOptions: [], surcharges: [] })
  const client = pm.client
  { const denied = denyUnless(pm.role, 'calc'); if (denied) return denied }

  const [{ data: mats }, { data: matrix }, { data: facets }, { data: surchargeData }, { data: svcData }] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true).order('category').order('name'),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
    svc.from('facet_prices').select('type_mm,sale_price').eq('active', true).order('type_mm'),
    svc.from('b2b_surcharge_rules').select('id,axis,min_mm,max_mm,surcharge_percent,label,shape_filter').eq('active', true).order('sort_order'),
    svc.from('b2b_services').select('id,name,type,value,active,sort_order').eq('active', true).order('sort_order').order('id'),
  ])

  const priced = prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>)

  // deny-by-default: наружу только безопасные поля
  // А12: в справочнике кабинета показываем цены этого клиента, если они заданы —
  // иначе партнёр увидел бы одну цену в списке, а в расчёте другую.
  // Без договорных цен справочник показал бы партнёру общие — лучше честная ошибка.
  let clientPrices: Map<number, number>
  try { clientPrices = await loadClientPrices(svc, client.id) }
  catch { return NextResponse.json({ error: 'Не удалось загрузить ваши цены — обновите страницу через минуту' }, { status: 503 }) }
  const withClientPrices = applyClientPrices(priced, clientPrices)
  const materials = withClientPrices
    .filter(m => (m.sale_price ?? 0) > 0)          // без цены — клиенту не показываем
    .filter(isClientCalculable)                    // рифлёное считает менеджер (24.11.2026)
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
    services: publicServices((svcData ?? []) as B2BService[]),
  })
}
