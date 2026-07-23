import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { isOwnerRole, explainAccess, type B2BScope } from '@/lib/getRole'

const asScope = (v: unknown): B2BScope =>
  v === 'mglass_only' ? 'mglass_only' : v === 'all_clients' ? 'all_clients' : null

// Диагностика прав: для выбранного сотрудника — роль, скоуп, права и почему он
// видит/не видит ключевые разделы. Тот же расчёт, что реальный гейт (explainAccess).
// Только владелец.

const CHECK_ROUTES: { path: string; label: string }[] = [
  { path: '/manager', label: 'Менеджер' },
  { path: '/commercial', label: 'Коммерческий' },
  { path: '/cfo', label: 'CFO / финансы' },
  { path: '/accounting', label: 'Бухгалтерия' },
  { path: '/calculator/b2b', label: 'B2B Калькулятор' },
  { path: '/b2b-orders', label: 'B2B Заказы' },
  { path: '/b2b-quotes', label: 'B2B Просчёты' },
  { path: '/production-app', label: 'Производство (цех)' },
  { path: '/installations', label: 'Монтажи' },
  { path: '/crm', label: 'CRM' },
  { path: '/admin/users', label: 'Пользователи (админ)' },
  { path: '/delivery/voronezh', label: 'Воронеж (отгрузки)' },
]

export async function GET(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: me } = await sb.from('users').select('role').eq('id', user.id).maybeSingle()
  if (!isOwnerRole(me?.role)) return NextResponse.json({ error: 'Только владелец' }, { status: 403 })

  const targetId = new URL(req.url).searchParams.get('userId')
  if (!targetId) {
    const { data: users } = await sb.from('users').select('id, name, email, role').eq('active', true).order('name')
    return NextResponse.json({ users: users ?? [] })
  }

  const { data: u } = await sb.from('users')
    .select('id, name, email, role, permissions, can_view_all_deals, can_view_all_clients, see_all_orders, production_stations')
    .eq('id', targetId).maybeSingle()
  if (!u) return NextResponse.json({ error: 'Сотрудник не найден' }, { status: 404 })

  const perms = (u.permissions ?? null) as { b2b_client_scope?: unknown } | null
  const scope: B2BScope = asScope(perms?.b2b_client_scope)
  const routes = CHECK_ROUTES.map(rt => ({
    ...rt, ...explainAccess(u.role, rt.path, { b2bScope: scope }),
  }))

  return NextResponse.json({
    user: {
      id: u.id, name: u.name, email: u.email, role: u.role,
      b2b_scope: scope, permissions: u.permissions,
      can_view_all_deals: u.can_view_all_deals, can_view_all_clients: u.can_view_all_clients,
      see_all_orders: u.see_all_orders, production_stations: u.production_stations,
    },
    routes,
  })
}
