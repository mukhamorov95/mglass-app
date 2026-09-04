import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

export const dynamic = 'force-dynamic'

// Модели зеркал для экрана выбора. Витрина, не себестоимость: отдаём только
// то, что и так видно на карточке. Цена появится своим роутом (маршрут З5).

export async function GET() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await createServiceClient()
    .from('mirror_models')
    .select('code, name, descr, shape, has_lighting, frame_kind, image_url')
    .eq('active', true)
    .order('sort', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ models: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}
