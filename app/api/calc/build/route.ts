import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { requirePageAccess } from '@/lib/apiAuth'
import { M_MODELS } from '@/lib/configurator/arrangement'
import { priceBuild, type BuildRequest } from '@/lib/calc/buildPrice'

export const dynamic = 'force-dynamic'

// Расчёт изделия для вкладки «Расчёт» кабинета менеджера — логика в lib/calc/buildPrice.ts.
// Ответ — себестоимость (₽/м² стекла, скидка M GLASS, закупка фурнитуры), поэтому
// пускаем только тех, кто может открыть саму вкладку; сессии мало — она есть у партнёра.

export async function POST(req: NextRequest) {
  const guard = await requirePageAccess('/calculator/build')
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => null) as Partial<BuildRequest> | null
  if (!body?.model || !body.dims || !M_MODELS.some(m => m.code === body.model)) {
    return NextResponse.json({ full: false, error: 'model + dims обязательны' }, { status: 400 })
  }
  const price = await priceBuild(createServiceClient(), body as BuildRequest)
  return NextResponse.json({ full: true, price }, { headers: { 'Cache-Control': 'no-store' } })
}
