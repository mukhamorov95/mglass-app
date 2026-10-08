import { randomInt } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { getSessionUser, type Role } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { STAFF_ROLES } from '@/lib/shopBoard/model'
import { linkUrl } from '@/lib/telegramLink'

// Самопривязка Telegram для уведомлений табло (docs/SHOP_BOARD_ROUTE.md, этап 2).
// Раньше код выдавал только владелец в «Пользователях»; теперь сотрудник берёт ссылку сам.
// Ссылка привязывает того, кто её получил: код живёт 15 минут и выдаётся только себе.
// Бот такому человеку присылает уведомления — меню владельца ему закрыто (lib/telegramLink).

async function me(): Promise<string | NextResponse> {
  const guard = await requireRole([...STAFF_ROLES] as Role[])
  if (guard instanceof NextResponse) return guard
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Нужен вход' }, { status: 401 })
  return user.id
}

export async function GET() {
  const userId = await me()
  if (userId instanceof NextResponse) return userId
  const { count, error } = await createServiceClient().from('telegram_users')
    .select('telegram_id', { count: 'exact', head: true }).eq('user_id', userId)
  if (error) return NextResponse.json({ error: `Привязка не прочиталась: ${error.message}` }, { status: 500 })
  return NextResponse.json({ linked: (count ?? 0) > 0 })
}

export async function POST() {
  const userId = await me()
  if (userId instanceof NextResponse) return userId
  const svc = createServiceClient()
  // Прежние невыданные коды этого человека гасим: действует только последняя ссылка.
  const { error: oldErr } = await svc.from('telegram_auth_codes').update({ used: true }).eq('user_id', userId).eq('used', false)
  if (oldErr) return NextResponse.json({ error: `Код не выдан: ${oldErr.message}` }, { status: 500 })
  const expires_at = new Date(Date.now() + 15 * 60_000).toISOString()
  for (let i = 0; i < 3; i++) {
    const code = String(randomInt(100000, 1000000))
    const { error } = await svc.from('telegram_auth_codes').insert({ code, user_id: userId, expires_at })
    if (!error) return NextResponse.json({ url: linkUrl(code) })
    if (error.code !== '23505') return NextResponse.json({ error: `Код не выдан: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ error: 'Код не выдан — попробуйте ещё раз' }, { status: 500 })
}
