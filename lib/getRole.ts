import { createClient } from './supabase-server'

export type Role = 'admin' | 'manager'

export async function getRole(): Promise<Role | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (data?.role === 'admin' || data?.role === 'manager') return data.role
  return null
}
