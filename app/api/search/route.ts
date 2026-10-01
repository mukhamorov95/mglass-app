import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getSessionUser, getUserProfile, canAccessRoute, isOwnerRole } from '@/lib/getRole'
import { MGLASS_CLIENT_IDS } from '@/lib/b2bScope'
import { parseQuery, toGroups, quickActions, type SearchPayload } from '@/lib/search'

// Поиск с любого экрана (У4). Изоляция в три слоя:
// 1) RLS вызывающего — app_search работает как SECURITY INVOKER;
// 2) группа ищется, только если роль может открыть её карточку (canAccessRoute);
// 3) правила страниц поверх RLS: «только M GLASS» у B2B и свои расчёты у менеджера.
//    До миграции 20260930_calculations_rls_isolation RLS расчётов пропускал всех
//    сотрудников; после неё фильтр совпадает с политикой и остаётся второй линией.
export async function GET(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Нужно войти' }, { status: 401 })
  const profile = await getUserProfile()
  if (!profile) return NextResponse.json({ error: 'Нет профиля пользователя' }, { status: 403 })

  const { role, permissions } = profile
  const opts = { b2bScope: permissions.b2b_client_scope ?? null, managerWorkspace: permissions.manager_workspace === true }
  const can = (path: string) => canAccessRoute(role, path, opts)
  const actions = quickActions(can)

  const { q, digits } = parseQuery(req.nextUrl.searchParams.get('q') ?? '')
  if (q.length < 2 && !digits) return NextResponse.json({ groups: [], actions })

  const supabase = await createClient()

  let calcOwner: string | null = user.id
  if (isOwnerRole(role)) {
    calcOwner = null
  } else {
    const { data: u, error: uErr } = await supabase.from('users').select('can_view_all_deals').eq('id', user.id).maybeSingle()
    if (uErr) return NextResponse.json({ error: 'Не удалось проверить права на расчёты' }, { status: 500 })
    if ((u as { can_view_all_deals?: boolean } | null)?.can_view_all_deals) calcOwner = null
  }

  const mglassOnly = permissions.b2b_client_scope === 'mglass_only'
  const canDeal = can('/deal/1')
  const { data, error } = await supabase.rpc('app_search', {
    p_q: q,
    p_digits: digits,
    p_orders: can('/b2b-deal/1'),
    p_mglass_ids: mglassOnly ? [...MGLASS_CLIENT_IDS] : null,
    p_clients: can('/b2b-crm/1') && !mglassOnly,
    p_deals: canDeal,
    p_calcs: can('/calculations/1'),
    p_calc_owner: calcOwner,
    p_limit: 6,
  })
  if (error) return NextResponse.json({ error: `Поиск не ответил: ${error.message}` }, { status: 500 })

  return NextResponse.json({ groups: toGroups(data as SearchPayload, canDeal), actions })
}
