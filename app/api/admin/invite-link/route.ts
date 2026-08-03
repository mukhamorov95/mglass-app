import { NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'
import { createSetupToken } from '@/lib/setupToken'

// Выдать ссылку самостоятельной установки пароля. Два режима:
//  • { email, role, name } — пригласить нового: создаём аккаунт БЕЗ известного
//    пароля, роль/имя проставляем, возвращаем ссылку.
//  • { userId }            — сбросить пароль существующему (ссылку он откроет сам).
// Пароль владелец не вводит и не узнаёт — в браузер владельца он не попадает.

function randomPw(): string {
  const arr = new Uint8Array(24)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(req: Request) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  let userId: string | null = null

  if (body.userId) {
    userId = String(body.userId)
  } else {
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Нужен email' }, { status: 400 })

    const { data: created, error } = await admin.auth.admin.createUser({
      email, password: randomPw(), email_confirm: true,
    })
    if (error) {
      // Возможно, аккаунт уже есть — находим его (пороли не меняем, вернём ссылку сброса).
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000, page: 1 })
      const found = list?.users.find(u => u.email?.toLowerCase() === email)
      if (!found) return NextResponse.json({ error: error.message }, { status: 400 })
      userId = found.id
    } else {
      userId = created.user.id
    }

    const fields: Record<string, unknown> = {}
    if (body.role) fields.role = String(body.role)
    if (body.name != null) fields.name = String(body.name) || null
    if (Object.keys(fields).length) await admin.from('users').update(fields).eq('id', userId)
  }

  if (!userId) return NextResponse.json({ error: 'Пользователь не найден' }, { status: 400 })

  const token = await createSetupToken(userId)
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, '')
  return NextResponse.json({ link: `${base}/set-password?token=${token}` })
}
