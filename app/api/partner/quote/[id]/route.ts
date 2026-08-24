import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// Загрузка просчёта партнёра для РЕДАКТИРОВАНИЯ. Отдаём спецификации позиций
// (входные параметры калькулятора), реконструированные из items — строго свой
// просчёт (b2b_clients.user_id = auth.uid()), не запущенный. Никакой себестоимости.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const oid = Number(id)
  if (!oid) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })
  // reorder=1 — «Повторить заказ»: только КЛОНИРУЕМ позиции в новый черновик, сам
  // заказ-источник не правим, поэтому гарды «запущен/не-quote» тут не применяются.
  const isReorder = new URL(_req.url).searchParams.get('reorder') === '1'

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: client } = await svc.from('b2b_clients').select('id').eq('user_id', user.id).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })

  const { data: order } = await svc.from('b2b_orders')
    .select('id,client_id,launched_at,notes,items').eq('id', oid).maybeSingle()
  const o = order as { client_id: number | null; launched_at: string | null; notes: string | null; items: unknown } | null
  if (!o || o.client_id !== (client as { id: number }).id) return NextResponse.json({ error: 'Просчёт не найден' }, { status: 404 })
  if (!isReorder && o.launched_at) return NextResponse.json({ error: 'Заказ уже в работе — редактирование недоступно' }, { status: 400 })

  let notes: Record<string, unknown> = {}
  try { notes = o.notes ? JSON.parse(o.notes) : {} } catch {}
  if (!isReorder && notes.status && notes.status !== 'quote') return NextResponse.json({ error: 'Просчёт нельзя редактировать' }, { status: 400 })

  const rawItems = Array.isArray(o.items) ? (o.items as Record<string, unknown>[]) : []
  const specs = rawItems.map(it => {
    const triplexGlasses = Array.isArray(it.triplexGlasses) ? (it.triplexGlasses as Record<string, unknown>[]) : []
    return {
      materialId: Number(it.materialId) || 0,
      width: Number(it.width) || 0,
      height: Number(it.height) || 0,
      quantity: Number(it.quantity) || 1,
      hasTempering: !!it.hasTempering,
      hasFacet: !!it.hasFacet,
      facetTypeMm: it.facetTypeMm != null ? Number(it.facetTypeMm) : null,
      hasHoles: !!it.hasHoles,
      shape: it.shape === 'curved' ? 'curved' : 'rect',
      hasTriplex: !!it.hasTriplex,
      triplexLayers: Number(it.triplexLayers) === 3 ? 3 : 2,
      triplexMat2Id: triplexGlasses[0] ? Number(triplexGlasses[0].materialId) || null : null,
      triplexMat3Id: triplexGlasses[1] ? Number(triplexGlasses[1].materialId) || null : null,
      applyMinPrice: it.applyMinPrice !== false,
    }
  })

  return NextResponse.json({ id: oid, comment: (notes.partner_comment as string) ?? '', specs })
}
