import { createServiceClient } from '@/lib/supabase-service'

// id карточки b2b_clients, привязанной к учётке партнёра (или null, если не привязан).
// Единая точка «кто этот партнёр» для серверных проверок доступа кабинета.
export async function getPartnerClientId(userId: string): Promise<number | null> {
  const svc = createServiceClient()
  const { data } = await svc
    .from('b2b_clients')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as { id: number } | null)?.id ?? null
}

// Виден ли заказ этому партнёру (client_id заказа == карточка партнёра).
export async function partnerOwnsOrder(userId: string, orderClientId: number | null | undefined): Promise<boolean> {
  if (orderClientId == null) return false
  const clientId = await getPartnerClientId(userId)
  return clientId != null && clientId === orderClientId
}
