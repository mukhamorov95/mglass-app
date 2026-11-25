import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { denyUnless, resolvePartnerMember } from '@/lib/partnerClient'
import { previewWriteGuard } from '@/lib/partnerPreview'
import { cleanClientNo } from '@/lib/partner/orderSearch'

// Номер заказа клиента (владелец 25.11.2026): клиент сам ставит и правит свой номер в любой момент —
// это его ссылка на заказ, на цену и производство не влияет. Наш номер не меняется.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = createServiceClient()
  const pm = await resolvePartnerMember<{ id: number }>(svc, user.id)
  if (!pm) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })
  { const denied = denyUnless(pm.role, 'calc'); if (denied) return denied }
  const blocked = await previewWriteGuard(svc, user.id, { allowOnTest: true })
  if (blocked) return blocked
  const body = await req.json().catch(() => ({})) as { clientOrderNumber?: unknown }
  const value = cleanClientNo(body.clientOrderNumber)
  const { data, error } = await svc.from('b2b_orders').update({ client_order_number: value })
    .eq('id', id).eq('client_id', pm.client.id).select('id, client_order_number')
  if (error) return NextResponse.json({ error: `Номер не сохранён: ${error.message}` }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })
  return NextResponse.json({ ok: true, clientOrderNumber: data[0].client_order_number ?? null })
}
