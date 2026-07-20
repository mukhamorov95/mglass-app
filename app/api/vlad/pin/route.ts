import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { checkPin, VLAD_PIN_COOKIE } from '@/lib/vlad/vladClient'

// Вход во вкладку /vlad: владелец + ПИН → httpOnly-кука на 12 часов.
// ПИН — защита экрана от посторонних глаз, не криптография: настоящая
// изоляция данных — отдельная база, недоступная никому кроме сервера.
export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== 'admin@mglass.ru') {
    return NextResponse.json({ error: 'Доступ только владельцу' }, { status: 403 })
  }
  const { pin } = await req.json().catch(() => ({}))
  if (!checkPin(String(pin ?? ''))) {
    return NextResponse.json({ error: 'Неверный ПИН' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(VLAD_PIN_COOKIE, '1', { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 * 60 * 12, path: '/' })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(VLAD_PIN_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' })
  return res
}
