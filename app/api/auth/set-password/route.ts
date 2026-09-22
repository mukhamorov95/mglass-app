import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { verifySetupToken, markSetupTokenUsed } from '@/lib/setupToken'

// Установить пароль по одноразовому токену. Публичный (пользователь ещё не вошёл),
// но действие защищено токеном. Токен гасим только ПОСЛЕ успешной смены пароля.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const token = String(body.token ?? '')
  const password = String(body.password ?? '')
  if (password.length < 8) return NextResponse.json({ error: 'Пароль минимум 8 символов' }, { status: 400 })

  const userId = await verifySetupToken(token)
  if (!userId) return NextResponse.json({ error: 'Ссылка недействительна или устарела' }, { status: 400 })

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { error } = await admin.auth.admin.updateUserById(userId, { password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await markSetupTokenUsed(token)
  // Пароль хранится только в Supabase Auth: колонка password_plain удалена
  // миграцией 20260922_drop_plain_passwords.
  return NextResponse.json({ ok: true })
}
