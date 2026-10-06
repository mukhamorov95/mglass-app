import { NextResponse } from 'next/server'
import { requireAnyPageAccess } from '@/lib/apiAuth'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'

// Кто смотрит «Показатели менеджеров»: все строки или только свои. Одна проверка
// на таблицу и на раскрытие по дням — иначе они разойдутся в правах.
export async function statsViewer(): Promise<{ me: string; canAll: boolean } | NextResponse> {
  const guard = await requireAnyPageAccess(['/sales/managers'])
  if (guard instanceof NextResponse) return guard

  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'no user' }, { status: 401 })
  const sbUser = await createClient()
  const { data: profile } = await sbUser.from('users')
    .select('name, role, can_view_all_deals').eq('id', user.id).maybeSingle()
  const me = (profile?.name as string) ?? user.email ?? ''
  const canAll = ['admin', 'ceo', 'commercial', 'cfo'].includes((profile?.role as string) ?? '')
    || profile?.can_view_all_deals === true
  return { me, canAll }
}
