import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { prepPricedMaterials } from '@/lib/b2bMaterialPricing'
import type { B2BMaterial } from '@/lib/types'

// Прайс материалов для партнёрского калькулятора. Отдаём ТОЛЬКО безопасные поля:
// id, название, категория, толщина, цена продажи. Никакой себестоимости/отхода/
// маржи. Считает и фильтрует сервер (service-role), партнёр к таблицам не ходит.

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: client } = await svc.from('b2b_clients').select('id,name,discount_percent').eq('user_id', user.id).maybeSingle()
  if (!client) return NextResponse.json({ linked: false, materials: [] })

  const [{ data: mats }, { data: matrix }] = await Promise.all([
    svc.from('b2b_materials').select('*').eq('active', true).order('category').order('name'),
    svc.from('glass_price_matrix').select('name,category,price_type,t4,t5,t6,t8,t10,waste_pct'),
  ])

  const priced = prepPricedMaterials((mats ?? []) as B2BMaterial[], (matrix ?? []) as Array<Record<string, unknown>>)

  // deny-by-default: наружу только безопасные поля
  const materials = priced.map(m => ({
    id: m.id,
    name: m.name,
    category: m.category,
    thickness: m.thickness,
    salePrice: m.sale_price,
  }))

  return NextResponse.json({ linked: true, discountPercent: Number(client.discount_percent) || 0, materials })
}
