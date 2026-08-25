import type { SupabaseClient } from '@supabase/supabase-js'

// A6: единая точка «какой компании принадлежит этот логин». Fail-closed:
//   1) первичный владелец  — b2b_clients.user_id = userId
//   2) участник команды     — b2b_client_members.user_id → client_id
// Нет совпадения → null (доступа нет). UNIQUE(user_id) в members гарантирует, что
// логин принадлежит ровно одной компании — изоляция не размывается.
//
// Все партнёрские эндпоинты резолвят клиента ТОЛЬКО через этот хелпер.

export async function resolvePartnerClient<T = { id: number }>(
  svc: SupabaseClient,
  userId: string,
  cols = 'id',
): Promise<T | null> {
  const { data: primary } = await svc.from('b2b_clients').select(cols).eq('user_id', userId).maybeSingle()
  if (primary) return primary as T

  const { data: member } = await svc.from('b2b_client_members').select('client_id').eq('user_id', userId).maybeSingle()
  if (!member) return null
  const { data: client } = await svc.from('b2b_clients').select(cols).eq('id', member.client_id as number).maybeSingle()
  return (client as T) ?? null
}
