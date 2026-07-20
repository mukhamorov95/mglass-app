import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase-server'

// Личный контур владельца живёт в ОТДЕЛЬНОМ проекте Supabase (vlad-personal).
// В той базе RLS включён без политик — снаружи не читается вообще, доступ
// только этим серверным клиентом. Ключи никогда не попадают на клиент.

const OWNER_EMAIL = 'admin@mglass.ru'
export const VLAD_PIN_COOKIE = 'vlad-pin-ok'

export function vladDb(): SupabaseClient | null {
  const url = process.env.VLAD_SUPABASE_URL
  const key = process.env.VLAD_SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

// Гейт: только аккаунт владельца И введённый ПИН (кука сессии).
// Роль admin недостаточна — вкладка личная, а не административная.
export async function requireVlad(req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== OWNER_EMAIL) return { ok: false, status: 403, error: 'Доступ только владельцу' }
  const cookies = req.headers.get('cookie') ?? ''
  const hasPin = cookies.split(';').some(c => c.trim().startsWith(`${VLAD_PIN_COOKIE}=1`))
  if (!hasPin) return { ok: false, status: 401, error: 'Нужен ПИН' }
  return { ok: true }
}

export function checkPin(pin: string): boolean {
  return pin === (process.env.VLAD_PIN ?? '95')
}
