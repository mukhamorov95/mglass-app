import { createServiceClient } from '@/lib/supabase-service'
import { resolvePartnerClient } from '@/lib/partnerClient'

// id карточки b2b_clients, к которой относится учётка партнёра (или null).
// Резолв — через resolvePartnerClient: основной логин, участник команды (A6)
// и режим «Смотреть как партнёр» решаются одинаково во всём кабинете.
export async function getPartnerClientId(userId: string): Promise<number | null> {
  const client = await resolvePartnerClient(createServiceClient(), userId)
  return client?.id ?? null
}

// Виден ли заказ этому партнёру (client_id заказа == карточка партнёра).
export async function partnerOwnsOrder(userId: string, orderClientId: number | null | undefined): Promise<boolean> {
  if (orderClientId == null) return false
  const clientId = await getPartnerClientId(userId)
  return clientId != null && clientId === orderClientId
}
