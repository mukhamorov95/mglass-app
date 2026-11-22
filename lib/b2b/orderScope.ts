import type { SupabaseClient } from '@supabase/supabase-js'
import { isOwnerRole } from '@/lib/getRole'

// Чужие заказы B2B в списке /b2b-orders и маршрутах под ним видят владельцы, закупщик (ведёт
// закупку и отгрузки по всем заказам) и сотрудник с флагом «Все» в /admin/users; остальные — свои.
export function seesAllOrders(role: string | null | undefined, seeAllOrders: boolean | null | undefined): boolean {
  return isOwnerRole(role) || role === 'buyer' || seeAllOrders === true
}

// Автор, которым сужается выборка заказов, или null — «видит все». Ошибку чтения профиля не
// глотаем: маршрут на service-role, и вместо догадки о праве лучше честный отказ.
export async function orderAuthorScope(svc: SupabaseClient, role: string, userId: string): Promise<string | null> {
  if (seesAllOrders(role, false)) return null
  const { data, error } = await svc.from('users').select('see_all_orders').eq('id', userId).maybeSingle()
  if (error) throw new Error(`профиль не прочитан: ${error.message}`)
  return seesAllOrders(role, (data as { see_all_orders?: boolean | null } | null)?.see_all_orders) ? null : userId
}
