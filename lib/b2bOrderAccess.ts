import { createClient } from '@/lib/supabase-server'
import { isOwnerRole, canAccessRoute } from '@/lib/getRole'

// Заказ B2B для печатных документов (счёт-спецификация, КП) с одной калиткой:
// роль должна открывать /b2b-quotes, а заказ — быть своим, своего клиента или
// старым без автора (только для ролей, которым они нужны по работе).
export async function loadOrderWithAccess(id: string) {
  const orderId = Number(id)
  if (!orderId) return { status: 400 as const, error: 'Invalid id' }

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { status: 401 as const, error: 'Unauthorized' }

  const { data: order, error } = await sb
    .from('b2b_orders')
    .select('id,client_id,client_name,custom_number,client_order_number,discount_percent,items,total_area,total_weight,total_sale_inc_vat,total_after_discount,notes,created_at,created_by')
    .eq('id', orderId)
    .single()
  if (error || !order) return { status: 404 as const, error: 'Not found' }

  const { data: profile } = await sb.from('users').select('role,see_all_orders,permissions').eq('id', user.id).maybeSingle()

  // Роль решается ТОЙ ЖЕ калиткой, что и страница счёта (/b2b-quotes): здесь
  // отдаются и правятся банковские реквизиты покупателя, и раньше роль не
  // проверялась вовсе — проходили цех, замерщик, закупщик, бухгалтерия.
  const perms = (profile?.permissions ?? null) as { b2b_client_scope?: unknown } | null
  const b2bScope = typeof perms?.b2b_client_scope === 'string' ? perms.b2b_client_scope : null
  if (!canAccessRoute(profile?.role, '/b2b-quotes', { b2bScope })) {
    return { status: 403 as const, error: 'Forbidden' }
  }

  // Заказы до 30.06 автора не имеют (4 275 из 5 258). Раньше это открывало их
  // КАЖДОМУ вошедшему: условие `created_by === null` стояло рядом с «это мой
  // заказ». Оставляем его только тем, кто и так видит чужие заказы.
  const seesOthers = isOwnerRole(profile?.role) || (profile?.see_all_orders ?? false)
  const canAccess =
    seesOthers ||
    order.created_by === user.id ||
    (order.created_by === null && legacyOrdersAllowed(profile?.role)) ||
    (order.client_id != null &&
      (await sb.from('b2b_clients').select('id').eq('id', order.client_id).eq('user_id', user.id).maybeSingle()).data != null)
  if (!canAccess) return { status: 403 as const, error: 'Forbidden' }

  return { status: 200 as const, sb, order, user, role: profile?.role ?? null }
}

// Менеджеру нужны старые заказы без автора — иначе 81% счетов ему недоступны.
// Закупщику и остальным ролям они не нужны: их работа — свои заказы.
const LEGACY_ROLES = new Set(['manager', 'commercial', 'accountant', 'cfo'])
function legacyOrdersAllowed(role: string | null | undefined): boolean {
  return !!role && LEGACY_ROLES.has(role)
}
