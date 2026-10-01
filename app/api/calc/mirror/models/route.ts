import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requirePageAccess } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// Модели зеркал для экрана выбора. Витрина, не себестоимость: отдаём только
// то, что и так видно на карточке. Цена появится своим роутом (маршрут З5).

export async function GET() {
  const guard = await requirePageAccess('/calculator/build')
  if (guard instanceof NextResponse) return guard

  const svc = createServiceClient()
  const [{ data, error }, { data: mats }] = await Promise.all([
    svc.from('mirror_models')
      .select('code, name, descr, shape, has_lighting, frame_kind, image_url')
      .eq('active', true)
      .order('sort', { ascending: true }),
    // Типы зеркал и доступные толщины — витрина для селекта. Цен здесь нет.
    svc.from('b2b_materials').select('name, thickness').eq('category', 'зеркало').eq('active', true),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byName = new Map<string, number[]>()
  for (const m of (mats ?? []) as { name: string; thickness: number }[]) {
    const mm = Math.round(Number(m.thickness))
    const arr = byName.get(m.name) ?? []
    if (!arr.includes(mm)) arr.push(mm)
    byName.set(m.name, arr)
  }
  const materials = [...byName.entries()]
    .map(([name, mms]) => ({ name, mms: mms.sort((a, b) => a - b) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  return NextResponse.json({ models: data ?? [], materials }, { headers: { 'Cache-Control': 'no-store' } })
}
