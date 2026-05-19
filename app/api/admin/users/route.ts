import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'
import { writeLogForCurrentUser } from '@/lib/activityLog'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET() {
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })

  const db = adminClient()

  // Try with new columns first; fall back to base columns if migration not run yet
  const full = await db
    .from('users')
    .select('id,email,name,role,active,manager_code,password_plain,see_all_orders,max_discount_percent,can_delete,permissions,created_at')
    .order('created_at', { ascending: true })

  if (!full.error) return NextResponse.json(full.data ?? [])

  const base = await db
    .from('users')
    .select('id,email,name,role,active,manager_code,password_plain,see_all_orders,created_at')
    .order('created_at', { ascending: true })

  if (base.error) return NextResponse.json({ error: base.error.message }, { status: 500 })
  return NextResponse.json(base.data ?? [])
}

export async function PATCH(req: NextRequest) {
  const role = await getRole()
  if (role !== 'admin') return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })

  const { id, password_plain, permissions, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  const db = adminClient()

  // Password change — update Supabase Auth too
  if (password_plain) {
    await db.auth.admin.updateUserById(id, { password: password_plain })
    fields.password_plain = password_plain
    await writeLogForCurrentUser('user.password_change', { entityType: 'user', entityId: id })
  }

  // Merge permissions into fields (jsonb column)
  if (permissions !== undefined) {
    fields.permissions = permissions
    await writeLogForCurrentUser('user.permission_change', {
      entityType: 'user',
      entityId: id,
      details: { permissions },
    })
  }

  if (Object.keys(fields).length > 0) {
    const { error } = await db.from('users').update(fields).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (!password_plain && permissions === undefined) {
      await writeLogForCurrentUser('user.update', {
        entityType: 'user',
        entityId: id,
        details: fields,
      })
    }
  }

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
