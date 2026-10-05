import 'server-only'
import { getSessionUser } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'

// Service-клиент от имени вошедшего: его правки журнал запишет на него, а не на
// «систему». Роль и права проверяет вызывающий — этот клиент обходит RLS.
export async function serviceAsMe() {
  const user = await getSessionUser()
  return createServiceClient({ actor: user?.id ?? null })
}
