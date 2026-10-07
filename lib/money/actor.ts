import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'

// Кто записывает деньги: id (uuid — для entered_by/voided_by) и имя для истории.
export async function currentActor(): Promise<{ id: string | null; name: string | null }> {
  const user = await getSessionUser()
  if (!user) return { id: null, name: null }
  const sb = await createClient()
  const { data } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
  return { id: user.id, name: ((data as { name?: string } | null)?.name ?? null) || user.email || null }
}
