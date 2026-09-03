import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { isOwnerRole } from '@/lib/getRole'

// Единая проверка прав+скоупа для ВСЕХ роутов /api/deals*. Вынесена, чтобы «в
// первом роуте есть, в остальных забыли» не повторилось (мина в amo-вебхуке была
// такой формы). Каждый роут обязан начать с requireDealActor().
//
// Кто работает со сделками B2C: менеджер (свои — созданные или где он ответственный),
// коммерческий/владелец/финансы — все; менеджер с can_view_all_clients — все.

const OWNER_LIKE = ['admin', 'ceo', 'commercial', 'cfo']

export type DealActor = {
  userId: string
  name: string | null
  role: string
  seeAll: boolean
}

export async function requireDealActor(): Promise<DealActor | NextResponse> {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const { data: profile } = await sb.from('users')
    .select('role, name, can_view_all_clients').eq('id', user.id).maybeSingle()
  const role = (profile?.role as string | undefined) ?? ''
  const allowed = isOwnerRole(role) || OWNER_LIKE.includes(role) || role === 'manager'
  if (!allowed) return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
  return {
    userId: user.id,
    name: (profile?.name as string) || user.email || null,
    role,
    seeAll: isOwnerRole(role) || OWNER_LIKE.includes(role) || profile?.can_view_all_clients === true,
  }
}

// Видит ли актор конкретную сделку (для карточки/привязки). Владелец/seeAll — да;
// менеджер — только свою (создал или назначен ответственным).
export function canSeeDeal(actor: DealActor, deal: { created_by: string | null; manager_id: string | null }): boolean {
  return actor.seeAll || deal.created_by === actor.userId || deal.manager_id === actor.userId
}
