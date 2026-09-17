import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { M_MODELS } from '@/lib/configurator/arrangement'
import { priceBuild, type BuildRequest } from '@/lib/calc/buildPrice'

export const dynamic = 'force-dynamic'

// Расчёт изделия для вкладки «Расчёт» кабинета менеджера — логика в lib/calc/buildPrice.ts.

export async function POST(req: NextRequest) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ full: false, error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as Partial<BuildRequest> | null
  if (!body?.model || !body.dims || !M_MODELS.some(m => m.code === body.model)) {
    return NextResponse.json({ full: false, error: 'model + dims обязательны' }, { status: 400 })
  }
  const price = await priceBuild(createServiceClient(), body as BuildRequest)
  return NextResponse.json({ full: true, price }, { headers: { 'Cache-Control': 'no-store' } })
}
