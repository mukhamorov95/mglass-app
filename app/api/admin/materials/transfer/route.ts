import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/apiAuth'

function db() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const guard = await requireRole(['admin', 'ceo', 'buyer'])
  if (guard instanceof NextResponse) return guard

  const { materialId, target, componentType, systemType } = await req.json()
  if (!materialId || !target) return NextResponse.json({ error: 'materialId and target required' }, { status: 400 })

  const db_ = db()

  // Читаем исходный материал
  const { data: mat, error: matErr } = await db_
    .from('materials').select('*').eq('id', materialId).single()
  if (matErr || !mat) return NextResponse.json({ error: 'Материал не найден' }, { status: 404 })

  let insertError: string | null = null

  if (target === 'mirror_lighting') {
    if (!componentType) return NextResponse.json({ error: 'componentType required' }, { status: 400 })
    const { error } = await db_.from('mirror_lighting_components').insert({
      component_type: componentType,
      name:           mat.name,
      description:    mat.comment ?? null,
      cost_price:     mat.cost_price,
      sale_price:     mat.sale_price ?? null,
      unit:           mat.unit,
    })
    insertError = error?.message ?? null

  } else if (target === 'hardware') {
    const type = systemType ?? 'universal'
    const { error } = await db_.from('hardware_items').insert({
      name:        mat.name,
      system_type: type,
      unit:        mat.unit,
      cost_price:  mat.cost_price,
      comment:     mat.comment ?? null,
    })
    insertError = error?.message ?? null
  } else {
    return NextResponse.json({ error: 'Unknown target' }, { status: 400 })
  }

  if (insertError && !insertError.includes('duplicate')) {
    return NextResponse.json({ error: insertError }, { status: 500 })
  }

  // Деактивируем в materials
  await db_.from('materials').update({ active: false }).eq('id', materialId)

  return NextResponse.json({ ok: true })
}
