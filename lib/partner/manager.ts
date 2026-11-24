import type { SupabaseClient } from '@supabase/supabase-js'

// «Ваш менеджер» в кабинете: ответственный за клиента (b2b_clients.manager_user_id).
// Наружу — только рабочие контакты: имя, рабочий телефон, Telegram (если привязан), рабочая почта.
export type ClientManager = { name: string; phone: string | null; telegram: string | null; email: string | null }

export async function loadClientManager(svc: SupabaseClient, clientId: number): Promise<ClientManager | null> {
  const { data: c } = await svc.from('b2b_clients').select('manager_user_id').eq('id', clientId).maybeSingle()
  const uid = (c as { manager_user_id?: string | null } | null)?.manager_user_id
  if (!uid) return null
  const [{ data: u }, { data: tg }] = await Promise.all([
    svc.from('users').select('name,email,work_phone').eq('id', uid).maybeSingle(),
    svc.from('telegram_users').select('username').eq('user_id', uid).not('username', 'is', null).limit(1).maybeSingle(),
  ])
  const user = u as { name?: string | null; email?: string | null; work_phone?: string | null } | null
  if (!user?.name) return null
  return {
    name: user.name,
    phone: user.work_phone?.trim() || null,
    telegram: (tg as { username?: string | null } | null)?.username?.replace(/^@/, '') || null,
    email: user.email?.endsWith('@mglass.ru') ? user.email : null,
  }
}
