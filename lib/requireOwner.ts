import { createClient } from './supabase-server'

const OWNER_EMAIL = 'admin@mglass.ru'

export async function getOwnerUser(): Promise<{ email: string; role: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (data?.role !== 'admin') return null
  if (user.email !== OWNER_EMAIL) return null

  return { email: user.email!, role: data.role }
}

export function isOwnerEmail(email: string | undefined): boolean {
  return email === OWNER_EMAIL
}
