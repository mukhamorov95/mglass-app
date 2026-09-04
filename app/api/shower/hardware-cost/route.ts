import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { hardwareCostFromVisualizer } from '@/lib/configurator/hardwareCost'

export const dynamic = 'force-dynamic'

// Себестоимость фурнитуры душевой по прайсу визуализатора — для экранов, которые
// считают в браузере (/calculator/shower). Единственный источник; ручная таблица
// shower_budget_manual_prices больше не участвует в цене.
// Только для авторизованных: себестоимость наружу не отдаём.
export async function GET(req: NextRequest) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const p = req.nextUrl.searchParams
  const modelId = (p.get('model') ?? '').trim()
  const width = Number(p.get('w'))
  const height = Number(p.get('h'))
  const width2 = p.get('w2') != null ? Number(p.get('w2')) : undefined
  const thickness = p.get('t') != null ? Number(p.get('t')) : 8

  if (!modelId || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return NextResponse.json({ error: 'model + w + h обязательны' }, { status: 400 })
  }

  const hw = await hardwareCostFromVisualizer({
    modelId, width, height,
    width2: Number.isFinite(width2 as number) ? width2 : undefined,
    thickness: Number.isFinite(thickness) ? thickness : 8,
    hardwareColor: p.get('color') ?? undefined,
  })

  // Модели вне ряда конфигуратора (M3/M5/M6) комплекта не имеют — цены нет.
  // Отдаём это явно, чтобы экран показал пробел, а не подставил старый флэт.
  if (!hw) return NextResponse.json({ found: false, reason: 'нет комплекта в прайсе визуализатора' })

  return NextResponse.json({ found: true, ...hw })
}
