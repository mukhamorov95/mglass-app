import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { getRole } from '@/lib/getRole'

export async function POST(req: NextRequest) {
  const role = await getRole()
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
  }

  const { email, password, role: newRole, name } = await req.json()
  if (!email || !password || !newRole) {
    return NextResponse.json({ error: 'Не все поля заполнены' }, { status: 400 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await adminClient
    .from('users')
    .update({ role: newRole, name: name || null, password_plain: password })
    .eq('id', data.user.id)

  return NextResponse.json({ id: data.user.id })
}
