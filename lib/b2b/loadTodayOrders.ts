import type { SupabaseClient } from '@supabase/supabase-js'
import type { TodayOrder } from './todayPriorities'

// Заказы для «Мой день · B2B» и разбора отгрузок — один запрос на оба экрана, чтобы
// разбор показывал ровно те заказы, которые наверху названы хвостом. Свои заказы;
// владелец и «видит все заказы» — все. Последние 120 дней.
export async function loadTodayOrders(sb: SupabaseClient): Promise<{ orders: TodayOrder[]; error: string | null }> {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return { orders: [], error: 'Не авторизован' }
  const { data: profile, error: profileErr } = await sb.from('users').select('role, see_all_orders').eq('id', user.id).maybeSingle()
  // Без профиля не понять, чьи заказы показывать: владелец увидел бы только свои и «всё разобрано».
  if (profileErr) return { orders: [], error: `Не удалось загрузить профиль: ${profileErr.message}. Обновите страницу.` }
  const seeAll = profile?.role === 'admin' || profile?.role === 'ceo' || profile?.see_all_orders === true

  const since = new Date(); since.setDate(since.getDate() - 120)
  // Страницами по 1000: PostgREST больше не отдаёт, а у владельца за 120 дней уже ~900 заказов.
  const orders: TodayOrder[] = []
  for (let page = 0; page < 20; page++) {
    let q = sb.from('b2b_orders')
      .select('id,client_name,custom_number,total_sale_inc_vat,total_after_discount,notes,created_at,updated_at,launched_at,created_by_name')
      .is('archived_at', null)
      .gte('created_at', since.toISOString())
      .order('id', { ascending: false })
      .range(page * 1000, page * 1000 + 999)
    if (!seeAll) q = q.eq('created_by', user.id)
    const { data, error } = await q
    if (error) return { orders: [], error: `Не удалось загрузить заказы: ${error.message}. Обновите страницу.` }
    orders.push(...((data ?? []) as TodayOrder[]))
    if (!data || data.length < 1000) break
  }
  return { orders, error: null }
}
