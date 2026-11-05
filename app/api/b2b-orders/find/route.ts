import { NextRequest, NextResponse } from 'next/server'
import { requireAnyPageAccess } from '@/lib/apiAuth'
import { getSessionUser, getUserProfile } from '@/lib/getRole'
import { findOrders } from '@/lib/b2b/findOrders'
import { createServiceClient } from '@/lib/supabase-service'

// Кто видит все заказы — те же, кому список заказов и цех показывают всё; менеджер ищет среди своих.
const SEE_ALL_ROLES: readonly string[] = ['admin', 'ceo', 'buyer', 'production']

export async function GET(req: NextRequest) {
  const guard = await requireAnyPageAccess(['/b2b-orders', '/production-app'])
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Нужно войти' }, { status: 401 })
  const profile = await getUserProfile()
  const svc = createServiceClient()
  const { data: me } = await svc.from('users').select('see_all_orders').eq('id', user.id).maybeSingle()
  const scoped = !!profile?.permissions?.b2b_client_scope && guard !== 'admin' && guard !== 'ceo'
  const seeAll = !scoped && (SEE_ALL_ROLES.includes(guard) || (me as { see_all_orders?: boolean } | null)?.see_all_orders === true)
  try {
    return NextResponse.json({ found: await findOrders(svc, req.nextUrl.searchParams.get('q') ?? '', seeAll ? null : user.id) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Поиск не ответил' }, { status: 500 })
  }
}
