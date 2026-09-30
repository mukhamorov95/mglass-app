import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-server'
import { getRole, isOwnerRole, type Role } from '@/lib/getRole'

// Кто пишет в историю расчётов. Партнёр считает в своём кабинете и в общую
// историю не пишет — то же правило, что стояло в RLS.
export async function calcWriter(): Promise<{ userId: string; role: Role } | { error: NextResponse }> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Нет активной сессии. Войдите в аккаунт.' }, { status: 401 }) }
  const role = await getRole()
  if (!role || role === 'partner') {
    return { error: NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 }) }
  }
  return { userId: user.id, role }
}

// «Видит все расчёты» в /calculations: владелец (admin/ceo) или галка «Все сделки».
// Одно определение для списка и для записи от его имени — дублировать можно то,
// что список показывает.
export async function seesAllCalculations(supabase: SupabaseClient, userId: string, role: Role | null): Promise<boolean> {
  if (isOwnerRole(role)) return true
  const { data, error } = await supabase.from('users').select('can_view_all_deals').eq('id', userId).maybeSingle()
  if (error) throw new Error(`Не удалось прочитать права пользователя: ${error.message}`)
  return (data as { can_view_all_deals?: boolean | null } | null)?.can_view_all_deals === true
}
