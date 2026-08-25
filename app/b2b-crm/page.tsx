import { redirect } from 'next/navigation'
import { getRole, isOwnerRole } from '@/lib/getRole'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { isMGlassOnlyUser, isAllClientsScope } from '@/lib/b2bScope'
import type { UserPermissions } from '@/lib/permissions'
import B2BCRMClient from './CRMClient'

// А1 маршрута менеджерского контура: карточка B2B-клиента доступна не только владельцу.
// Менеджер видит своих клиентов (или всех — по галке can_view_all_clients / скоупу),
// но не переназначает ответственного: это остаётся владельческим действием.

const ALLOWED = ['admin', 'ceo', 'manager', 'commercial', 'buyer']

export default async function B2BCRMPage() {
  const role = await getRole()
  if (!role || !ALLOWED.includes(role)) redirect('/access-denied')

  const owner = isOwnerRole(role)
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()

  let canSeeAll = owner
  let mglassOnly = false
  if (user?.id) {
    const { data: profile } = await sb
      .from('users')
      .select('can_view_all_clients, permissions')
      .eq('id', user.id)
      .maybeSingle()
    const perms = (profile?.permissions ?? null) as UserPermissions | null
    canSeeAll  = owner || profile?.can_view_all_clients === true || isAllClientsScope(perms)
    mglassOnly = !owner && isMGlassOnlyUser(perms)
  }

  return (
    <B2BCRMClient
      isOwner={owner}
      canSeeAll={canSeeAll}
      mglassOnly={mglassOnly}
      myUserId={user?.id ?? null}
    />
  )
}
