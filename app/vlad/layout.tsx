import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'

// Личная вкладка владельца. Жёстче обычного: не роль, а конкретный аккаунт —
// ceo-роль тоже owner-tier, но эта страница не административная, а личная.
export default async function VladLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== 'admin@mglass.ru') redirect('/')
  return <>{children}</>
}
