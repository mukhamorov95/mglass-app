import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })

  const { data, error } = await adminClient()
    .from('users')
    .select('id,email,name,role,active,manager_code,password_plain,see_all_orders,created_at')
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })

  const { id, password_plain, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const db = adminClient()

  // If password is being updated — change it in Supabase Auth too
  if (password_plain) {
    await db.auth.admin.updateUserById(id, { password: password_plain })
    fields.password_plain = password_plain
  }

  const { error } = await db.from('users').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })

  const { action, userId } = await req.json()
  if (action !== 'telegram_code' || !userId) return NextResponse.json({ error: 'bad request' }, { status: 400 })

  const code = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  await adminClient().from('telegram_auth_codes').insert({ code, user_id: userId, expires_at: expiresAt })
  return NextResponse.json({ code })
}
